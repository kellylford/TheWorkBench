using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using QuickMail.Models;

namespace QuickMail.Services;

public class SyncService : ISyncService
{
    private readonly IImapService _imap;
    private readonly ILocalStoreService _store;

    public SyncService(IImapService imap, ILocalStoreService store)
    {
        _imap  = imap;
        _store = store;
    }

    public event Action<IReadOnlyList<MailMessageSummary>>? FolderSynced;
    public event Action<IReadOnlyList<MailMessageSummary>>? MessagesRemoved;

    public async Task SyncAllAccountsAsync(
        IEnumerable<AccountModel> accounts,
        IReadOnlyDictionary<Guid, List<MailFolderModel>> cachedFolders,
        CancellationToken ct)
    {
        foreach (var account in accounts)
        {
            ct.ThrowIfCancellationRequested();
            if (!cachedFolders.TryGetValue(account.Id, out var folders)) continue;

            foreach (var folder in folders)
            {
                ct.ThrowIfCancellationRequested();
                if (folder.ExcludeFromAllMail) continue;

                try
                {
                    await SyncFolderAsync(account, folder, ct);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    LogService.Log($"Sync {account.DisplayName}/{folder.DisplayName}", ex);
                }
            }
        }
    }

    private async Task SyncFolderAsync(AccountModel account, MailFolderModel folder, CancellationToken ct)
    {
        // ── New messages ─────────────────────────────────────────────────────────
        var maxUid   = await _store.GetMaxUidAsync(account.Id, folder.FullName);
        var incoming = await _imap.GetMessagesSinceAsync(account.Id, folder.FullName, maxUid, ct);

        if (incoming.Count > 0)
        {
            await _store.UpsertSummariesAsync(incoming);

            // Show messages immediately — don't wait for body preview fetches.
            await Application.Current.Dispatcher.InvokeAsync(
                () => FolderSynced?.Invoke(incoming));

            // Fetch previews in the background. Capped at the 100 most-recent so
            // a first-sync of 500+ messages doesn't stall behind hundreds of IMAP
            // round-trips. The same summary objects are referenced by the VM's
            // Messages collection, so setting Preview on them updates the UI via
            // ObservableProperty without any additional event plumbing.
            if (account.PreviewLines > 0)
                _ = FetchAndApplyPreviewsAsync(account, folder, incoming, ct);
        }

        // ── Remote deletions ─────────────────────────────────────────────────────
        // Only meaningful when we already have local data for this folder.
        var localUids = await _store.GetAllUidsAsync(account.Id, folder.FullName);
        if (localUids.Count == 0) return;

        var serverUids = await _imap.GetFolderUidsAsync(account.Id, folder.FullName, ct);
        var serverSet  = new HashSet<uint>(serverUids);
        var deletedUids = localUids.Where(u => !serverSet.Contains(u)).ToList();

        if (deletedUids.Count == 0) return;

        LogService.Log($"Sync {account.DisplayName}/{folder.FullName}: {deletedUids.Count} remote deletion(s)");
        await _store.DeleteSummariesAsync(account.Id, folder.FullName, deletedUids);

        var removed = deletedUids
            .Select(uid => new MailMessageSummary
            {
                UniqueId   = uid,
                AccountId  = account.Id,
                FolderName = folder.FullName,
            })
            .ToList();

        await Application.Current.Dispatcher.InvokeAsync(
            () => MessagesRemoved?.Invoke(removed));
    }

    private async Task FetchAndApplyPreviewsAsync(
        AccountModel account, MailFolderModel folder,
        List<MailMessageSummary> incoming, CancellationToken ct)
    {
        try
        {
            var uids = incoming
                .OrderByDescending(s => s.Date)
                .Take(100)
                .Select(s => s.UniqueId)
                .ToList();

            var previews = await _imap.FetchPreviewsAsync(
                account.Id, folder.FullName, uids, account.PreviewLines, ct);

            foreach (var s in incoming)
            {
                if (!previews.TryGetValue(s.UniqueId, out var p)) continue;

                await Application.Current.Dispatcher.InvokeAsync(() => s.Preview = p);
                await _store.UpdatePreviewAsync(s.AccountId, s.FolderName, s.UniqueId, p);
            }
        }
        catch (OperationCanceledException) { /* sync cancelled — normal */ }
        catch (Exception ex)
        {
            LogService.Log($"FetchAndApplyPreviews {account.DisplayName}/{folder.FullName}", ex);
        }
    }
}

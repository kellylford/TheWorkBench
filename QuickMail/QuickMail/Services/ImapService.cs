using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MailKit;
using MailKit.Net.Imap;
using MailKit.Search;
using MailKit.Security;
using MimeKit;
using QuickMail.Models;

namespace QuickMail.Services;

public class ImapService : IImapService
{
    private readonly Dictionary<Guid, ImapClient> _clients = [];
    private readonly Dictionary<Guid, AccountModel> _accounts = [];
    private bool _disposed;

    public async Task ConnectAsync(AccountModel account, string password, CancellationToken ct = default)
    {
        if (_clients.TryGetValue(account.Id, out var existing))
        {
            if (existing.IsConnected) return;
            existing.Dispose();
            _clients.Remove(account.Id);
        }

        var client = new ImapClient();

        if (account.ImapAcceptInvalidCert)
            client.ServerCertificateValidationCallback = (_, _, _, _) => true;

        var ssl = account.ImapUseSsl
            ? SecureSocketOptions.SslOnConnect
            : SecureSocketOptions.StartTlsWhenAvailable;

        LogService.Log($"Connecting to {account.ImapHost}:{account.ImapPort} ssl={account.ImapUseSsl} user={account.Username}");
        await client.ConnectAsync(account.ImapHost, account.ImapPort, ssl, ct);
        await client.AuthenticateAsync(account.Username, password, ct);
        LogService.Log($"Connected. Capabilities: {client.Capabilities}");

        _clients[account.Id] = client;
        _accounts[account.Id] = account;
    }

    public async Task DisconnectAsync(Guid accountId, CancellationToken ct = default)
    {
        if (_clients.TryGetValue(accountId, out var client))
        {
            if (client.IsConnected)
                await client.DisconnectAsync(true, ct);
            client.Dispose();
            _clients.Remove(accountId);
            _accounts.Remove(accountId);
        }
    }

    public async Task<List<MailFolderModel>> GetFoldersAsync(Guid accountId, CancellationToken ct = default)
    {
        var client = GetClient(accountId);
        var result = new List<MailFolderModel>();

        // Always put INBOX first — many servers don't return it via GetFoldersAsync
        try
        {
            var inbox = client.Inbox;
            await inbox.OpenAsync(FolderAccess.ReadOnly, ct);
            LogService.Log($"INBOX: FullName={inbox.FullName} Count={inbox.Count} Unread={inbox.Unread}");
            result.Add(new MailFolderModel
            {
                FullName = inbox.FullName,
                DisplayName = "Inbox",
                UnreadCount = inbox.Unread,
                AccountId = accountId
            });
            await inbox.CloseAsync(false, ct);
        }
        catch (Exception ex)
        {
            LogService.Log("GetFolders/Inbox", ex);
        }

        // Enumerate all other folders
        var folders = await client.GetFoldersAsync(client.PersonalNamespaces[0], cancellationToken: ct);
        LogService.Log($"GetFoldersAsync returned {folders.Count} folders");

        foreach (var folder in folders)
        {
            if ((folder.Attributes & FolderAttributes.NonExistent) != 0) continue;
            if ((folder.Attributes & FolderAttributes.NoSelect) != 0) continue;  // can't open / read
            if (folder.FullName == client.Inbox.FullName) continue;               // already added

            try
            {
                await folder.OpenAsync(FolderAccess.ReadOnly, ct);
                LogService.Log($"  Folder: {folder.FullName} Count={folder.Count} Unread={folder.Unread}");
                var unread = folder.Unread;
                await folder.CloseAsync(false, ct);

                result.Add(new MailFolderModel
                {
                    FullName = folder.FullName,
                    DisplayName = folder.Name,
                    UnreadCount = unread,
                    AccountId = accountId
                });
            }
            catch (Exception ex)
            {
                LogService.Log($"  Cannot open folder {folder.FullName}: {ex.Message}");
                // Still add it so the user can see it exists
                result.Add(new MailFolderModel
                {
                    FullName = folder.FullName,
                    DisplayName = folder.Name,
                    UnreadCount = 0,
                    AccountId = accountId
                });
            }
        }

        LogService.Log($"GetFoldersAsync: returning {result.Count} folders");
        return result;
    }

    public async Task<List<MailMessageSummary>> GetMessageSummariesAsync(
        Guid accountId, string folderName, int maxMessages, CancellationToken ct = default)
    {
        LogService.Log($"GetMessageSummaries: folder={folderName} maxMessages={maxMessages}");
        var client = GetClient(accountId);
        var folder = await client.GetFolderAsync(folderName, ct);
        LogService.Log($"  Got folder object: {folder.FullName}");
        await folder.OpenAsync(FolderAccess.ReadOnly, ct);
        LogService.Log($"  Opened. Count={folder.Count} Unread={folder.Unread} Recent={folder.Recent}");

        try
        {
            var count = folder.Count;
            if (count == 0)
            {
                LogService.Log("  Folder is empty — no messages to fetch");
                return [];
            }

            var startIndex = Math.Max(0, count - maxMessages);
            var summaries = await folder.FetchAsync(
                startIndex, -1,
                MessageSummaryItems.UniqueId
                | MessageSummaryItems.Envelope
                | MessageSummaryItems.Flags,
                ct);

            var result = summaries
                .OrderByDescending(s => s.Envelope?.Date ?? DateTimeOffset.MinValue)
                .Select(s => new MailMessageSummary
                {
                    UniqueId = s.UniqueId.Id,
                    AccountId = accountId,
                    FolderName = folderName,
                    From = FormatAddressList(s.Envelope?.From),
                    Subject = s.Envelope?.Subject ?? "(no subject)",
                    Date = s.Envelope?.Date ?? DateTimeOffset.MinValue,
                    IsRead = (s.Flags & MessageFlags.Seen) != 0
                })
                .ToList();

            LogService.Log($"  Returning {result.Count} message summaries");
            return result;
        }
        finally
        {
            await folder.CloseAsync(false, ct);
        }
    }

    public async Task<MailMessageDetail> GetMessageDetailAsync(
        Guid accountId, string folderName, uint uid, CancellationToken ct = default)
    {
        var client = GetClient(accountId);
        var folder = await client.GetFolderAsync(folderName, ct);
        await folder.OpenAsync(FolderAccess.ReadWrite, ct);

        try
        {
            var mailKitUid = new UniqueId(uid);
            var summaries = await folder.FetchAsync(
                new[] { mailKitUid },
                MessageSummaryItems.UniqueId
                | MessageSummaryItems.Envelope
                | MessageSummaryItems.Flags
                | MessageSummaryItems.BodyStructure,
                ct);

            var s = summaries.FirstOrDefault()
                ?? throw new InvalidOperationException($"Message UID {uid} not found.");

            // Download body parts — prefer HTML (richer), also grab plain text as fallback
            string plainText = string.Empty;
            string htmlText = string.Empty;

            if (s.HtmlBody != null)
            {
                var bodyPart = await folder.GetBodyPartAsync(mailKitUid, s.HtmlBody, ct);
                if (bodyPart is TextPart tp)
                    htmlText = tp.Text ?? string.Empty;
            }

            if (s.TextBody != null)
            {
                var bodyPart = await folder.GetBodyPartAsync(mailKitUid, s.TextBody, ct);
                if (bodyPart is TextPart tp)
                    plainText = tp.Text ?? string.Empty;
            }

            // Mark as read
            await folder.AddFlagsAsync(mailKitUid, MessageFlags.Seen, true, ct);

            return new MailMessageDetail
            {
                UniqueId = uid,
                AccountId = accountId,
                FolderName = folderName,
                From = FormatAddressList(s.Envelope?.From),
                To = FormatAddressList(s.Envelope?.To),
                Cc = FormatAddressList(s.Envelope?.Cc),
                ReplyTo = FormatAddressList(s.Envelope?.ReplyTo),
                Subject = s.Envelope?.Subject ?? "(no subject)",
                Date = s.Envelope?.Date ?? DateTimeOffset.MinValue,
                IsRead = true,
                MessageId = s.Envelope?.MessageId ?? string.Empty,
                PlainTextBody = plainText,
                HtmlBody = htmlText
            };
        }
        finally
        {
            await folder.CloseAsync(false, ct);
        }
    }

    public async Task MarkReadAsync(Guid accountId, string folderName, uint uid, CancellationToken ct = default)
    {
        var client = GetClient(accountId);
        var folder = await client.GetFolderAsync(folderName, ct);
        await folder.OpenAsync(FolderAccess.ReadWrite, ct);
        try
        {
            await folder.AddFlagsAsync(new UniqueId(uid), MessageFlags.Seen, true, ct);
        }
        finally
        {
            await folder.CloseAsync(false, ct);
        }
    }

    public async Task MoveToTrashBatchAsync(Guid accountId, string folderName, IList<uint> uids, CancellationToken ct = default)
    {
        var client = GetClient(accountId);
        var folder = await client.GetFolderAsync(folderName, ct);
        await folder.OpenAsync(FolderAccess.ReadWrite, ct);
        try
        {
            var uidList = uids.Select(u => new UniqueId(u)).ToList();

            IMailFolder? trash = null;
            foreach (var sf in new[] { SpecialFolder.Trash, SpecialFolder.Junk })
            {
                try { trash = client.GetFolder(sf); break; }
                catch { /* not available */ }
            }

            if (trash != null)
                await folder.MoveToAsync(uidList, trash, ct);
            else
                await folder.AddFlagsAsync(uidList, MessageFlags.Deleted, true, ct);
        }
        finally
        {
            await folder.CloseAsync(false, ct);
        }
    }

    public async Task MoveToTrashAsync(Guid accountId, string folderName, uint uid, CancellationToken ct = default)
    {
        var client = GetClient(accountId);
        var folder = await client.GetFolderAsync(folderName, ct);
        await folder.OpenAsync(FolderAccess.ReadWrite, ct);

        try
        {
            // Try to find the Trash folder
            IMailFolder? trash = null;
            foreach (var specialFolder in new[]
            {
                SpecialFolder.Trash, SpecialFolder.Junk
            })
            {
                try { trash = client.GetFolder(specialFolder); break; }
                catch { /* not available */ }
            }

            if (trash != null)
                await folder.MoveToAsync(new UniqueId(uid), trash, ct);
            else
                await folder.AddFlagsAsync(new UniqueId(uid), MessageFlags.Deleted, true, ct);
        }
        finally
        {
            await folder.CloseAsync(false, ct);
        }
    }

    public async Task<int> PollAsync(Guid accountId, string folderName, CancellationToken ct = default)
    {
        var client = GetClient(accountId);
        var folder = await client.GetFolderAsync(folderName, ct);
        await folder.OpenAsync(FolderAccess.ReadOnly, ct);
        try
        {
            await folder.CheckAsync(ct);
            return folder.Unread;
        }
        finally
        {
            await folder.CloseAsync(false, ct);
        }
    }

    private ImapClient GetClient(Guid accountId) =>
        _clients.TryGetValue(accountId, out var client) && client.IsConnected
            ? client
            : throw new InvalidOperationException($"Account {accountId} is not connected.");

    private static string FormatAddressList(InternetAddressList? list)
    {
        if (list == null || list.Count == 0) return string.Empty;
        return string.Join(", ", list.Select(a => a.ToString()));
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var client in _clients.Values)
        {
            try { client.Dispose(); } catch { /* best effort */ }
        }
        _clients.Clear();
    }
}

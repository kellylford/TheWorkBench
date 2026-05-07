using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using QuickMail.Models;

namespace QuickMail.Services;

public interface ISyncService
{
    /// <summary>
    /// Fired on the UI thread after each folder is synced, with only the
    /// messages that were not already in the local store.
    /// </summary>
    event Action<IReadOnlyList<MailMessageSummary>>? FolderSynced;

    /// <summary>
    /// Fired on the UI thread when messages that exist locally are no longer
    /// present on the server (deleted by another client).
    /// </summary>
    event Action<IReadOnlyList<MailMessageSummary>>? MessagesRemoved;

    Task SyncAllAccountsAsync(
        IEnumerable<AccountModel> accounts,
        IReadOnlyDictionary<Guid, List<MailFolderModel>> cachedFolders,
        CancellationToken ct);
}

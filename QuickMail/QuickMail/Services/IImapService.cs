using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using QuickMail.Models;

namespace QuickMail.Services;

public interface IImapService : IDisposable
{
    Task ConnectAsync(AccountModel account, string password, CancellationToken ct = default);
    Task DisconnectAsync(Guid accountId, CancellationToken ct = default);
    Task<List<MailFolderModel>> GetFoldersAsync(Guid accountId, CancellationToken ct = default);
    Task<List<MailMessageSummary>> GetMessageSummariesAsync(
        Guid accountId, string folderName, int maxMessages, CancellationToken ct = default);
    Task<MailMessageDetail> GetMessageDetailAsync(
        Guid accountId, string folderName, uint uid, CancellationToken ct = default);
    Task MarkReadAsync(Guid accountId, string folderName, uint uid, CancellationToken ct = default);
    Task MoveToTrashAsync(Guid accountId, string folderName, uint uid, CancellationToken ct = default);
    Task MoveToTrashBatchAsync(Guid accountId, string folderName, IList<uint> uids, CancellationToken ct = default);
    Task<int> PollAsync(Guid accountId, string folderName, CancellationToken ct = default);
}

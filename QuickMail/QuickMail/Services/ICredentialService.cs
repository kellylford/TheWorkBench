using System;

namespace QuickMail.Services;

public interface ICredentialService
{
    void SavePassword(Guid accountId, string password);
    string? GetPassword(Guid accountId);
    void DeletePassword(Guid accountId);
}

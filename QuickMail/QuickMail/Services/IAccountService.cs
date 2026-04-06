using System.Collections.Generic;
using QuickMail.Models;

namespace QuickMail.Services;

public interface IAccountService
{
    List<AccountModel> LoadAccounts();
    void SaveAccounts(List<AccountModel> accounts);
}

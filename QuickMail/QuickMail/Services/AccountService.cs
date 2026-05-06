using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using QuickMail.Models;

namespace QuickMail.Services;

public class AccountService : IAccountService
{
    private static readonly string DataFolder =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "QuickMail");

    private static readonly string AccountsFile = Path.Combine(DataFolder, "accounts.json");

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public List<AccountModel> LoadAccounts()
    {
        if (!File.Exists(AccountsFile))
            return [];

        try
        {
            var json = File.ReadAllText(AccountsFile);
            var accounts = JsonSerializer.Deserialize<List<AccountModel?>>(json, JsonOptions) ?? [];
            return accounts.Where(a => a is not null).Cast<AccountModel>().ToList();
        }
        catch
        {
            return [];
        }
    }

    public void SaveAccounts(List<AccountModel> accounts)
    {
        Directory.CreateDirectory(DataFolder);
        var json = JsonSerializer.Serialize(accounts, JsonOptions);
        File.WriteAllText(AccountsFile, json);
    }
}

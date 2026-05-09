using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using QuickMail.Models;
using QuickMail.Services;

namespace QuickMail.Views;

/// <summary>
/// Modal folder picker backed by a real WPF TreeView so screen readers
/// announce role, level, expanded/collapsed state correctly.
/// </summary>
public partial class FolderPickerWindow : Window
{
    private readonly Dictionary<MailFolderModel, AccountModel> _folderToAccount = new();

    public MailFolderModel? SelectedFolder { get; private set; }
    public AccountModel? SelectedAccount { get; private set; }

    public FolderPickerWindow(IEnumerable<AccountModel> accounts, IReadOnlyDictionary<Guid, List<MailFolderModel>> cachedFolders, MailFolderModel? allMailFolder = null)
    {
        InitializeComponent();

        var roots = new List<FolderTreeNode>();

        // Virtual "All Mail" node at the top of the tree
        if (allMailFolder != null)
            roots.Add(new FolderTreeNode { Folder = allMailFolder, Label = allMailFolder.DisplayName, IsExpanded = true });

        foreach (var account in accounts)
        {
            if (!cachedFolders.TryGetValue(account.Id, out var folders) || folders.Count == 0) continue;

            foreach (var f in folders)
                _folderToAccount[f] = account;

            var accountRoots = FolderTreeBuilder.Build(folders, account);
            foreach (var r in accountRoots)
                roots.Add(r);
        }

        FolderTreeView.ItemsSource = roots;

        Loaded += (_, _) => FolderTreeView.Focus();
    }

    private void OpenButton_Click(object sender, RoutedEventArgs e) => Commit();

    private void FolderTreeView_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            Commit();
        }
    }

    private void Commit()
    {
        if (FolderTreeView.SelectedItem is FolderTreeNode node && node.Folder != null)
        {
            SelectedFolder = node.Folder;
            _folderToAccount.TryGetValue(node.Folder, out var account);
            SelectedAccount = account;
            DialogResult = true;
        }
    }
}

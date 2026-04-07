using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using QuickMail.Models;

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

// ── Tree node ────────────────────────────────────────────────────────────────

/// <summary>One node in the folder tree view.</summary>
public sealed class FolderTreeNode
{
    /// <summary>Null for purely synthetic intermediate nodes that have no real IMAP folder.</summary>
    public MailFolderModel? Folder { get; init; }
    public string Label { get; init; } = string.Empty;
    public ObservableCollection<FolderTreeNode> Children { get; } = [];

    private bool _isExpanded;
    public bool IsExpanded
    {
        get => _isExpanded;
        set
        {
            _isExpanded = value;
            foreach (var child in Children)
                child.IsExpanded = value;
        }
    }
}

// ── Tree builder ─────────────────────────────────────────────────────────────

internal static class FolderTreeBuilder
{
    public static List<FolderTreeNode> Build(IEnumerable<MailFolderModel> flat, AccountModel? account = null)
    {
        var list = flat.ToList();
        if (list.Count == 0) return [];

        // Detect separator: use the character between the first two path segments.
        // MailKit uses '.' or '/' depending on the server's namespace separator.
        char sep = DetectSeparator(list);

        // Sort: INBOX first, then alphabetically
        list.Sort((a, b) =>
        {
            bool aInbox = a.FullName.Equals("INBOX", StringComparison.OrdinalIgnoreCase);
            bool bInbox = b.FullName.Equals("INBOX", StringComparison.OrdinalIgnoreCase);
            if (aInbox && !bInbox) return -1;
            if (!aInbox && bInbox) return 1;
            return string.Compare(a.FullName, b.FullName, StringComparison.OrdinalIgnoreCase);
        });

        // Build a dictionary of path → node so we can attach children to parents
        var folderRoots = new List<FolderTreeNode>();
        var byPath = new Dictionary<string, FolderTreeNode>(StringComparer.OrdinalIgnoreCase);

        foreach (var folder in list)
        {
            var parts = folder.FullName.Split(sep);
            EnsurePath(parts, folder, sep, folderRoots, byPath);
        }

        // Wrap folder roots under the account as the top-level tree node
        if (account != null)
        {
            var accountNode = new FolderTreeNode
            {
                Label = account.DisplayName,
                Folder = null,
                IsExpanded = true
            };
            foreach (var root in folderRoots)
                accountNode.Children.Add(root);
            return [accountNode];
        }

        return folderRoots;
    }

    private static void EnsurePath(
        string[] parts,
        MailFolderModel folder,
        char sep,
        List<FolderTreeNode> roots,
        Dictionary<string, FolderTreeNode> byPath)
    {
        for (int i = 0; i < parts.Length; i++)
        {
            var path = string.Join(sep, parts[..( i + 1)]);

            if (byPath.ContainsKey(path)) continue;

            // Is this the leaf (the real folder) or an intermediate?
            bool isLeaf = (i == parts.Length - 1);
            MailFolderModel? folderForNode = isLeaf ? folder : null;
            string label = isLeaf
                ? BuildLabel(folder)
                : parts[i]; // intermediate — just the segment name

            var node = new FolderTreeNode { Folder = folderForNode, Label = label };
            byPath[path] = node;

            if (i == 0)
                roots.Add(node);
            else
            {
                var parentPath = string.Join(sep, parts[..i]);
                if (byPath.TryGetValue(parentPath, out var parent))
                    parent.Children.Add(node);
                else
                    roots.Add(node); // orphan — treat as root
            }
        }
    }

    private static string BuildLabel(MailFolderModel f) =>
        f.UnreadCount > 0 ? $"{f.DisplayName} ({f.UnreadCount} unread)" : f.DisplayName;

    private static char DetectSeparator(List<MailFolderModel> folders)
    {
        foreach (var f in folders)
        {
            if (f.FullName.Contains('/')) return '/';
            if (f.FullName.Contains('.')) return '.';
        }
        return '.'; // safe default
    }
}

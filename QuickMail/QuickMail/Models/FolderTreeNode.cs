using System.Collections.ObjectModel;
using System.ComponentModel;

namespace QuickMail.Models;

/// <summary>
/// One node in the folder tree view, used in both the main window and the folder picker.
/// </summary>
public sealed class FolderTreeNode : INotifyPropertyChanged
{
    /// <summary>Null for account-group nodes and synthetic intermediate nodes that have no real IMAP folder.</summary>
    public MailFolderModel? Folder { get; init; }

    /// <summary>True for account-level group nodes that serve as collapsible containers for folder children.</summary>
    public bool IsHeader { get; init; }

    public string Label { get; init; } = string.Empty;

    public ObservableCollection<FolderTreeNode> Children { get; } = [];

    /// <summary>
    /// Accessibility label used by AutomationProperties.Name.
    /// Folder nodes include the unread count; account-group and intermediate nodes use just the label.
    /// </summary>
    public string AutomationName =>
        Folder is { UnreadCount: > 0 } ? $"{Label}, {Folder.UnreadCount} unread" : Label;

    private bool _isExpanded;

    /// <summary>
    /// Whether this tree node is expanded. Raises PropertyChanged so TwoWay bindings
    /// from the TreeViewItem.IsExpanded property reflect in the data model.
    /// </summary>
    public bool IsExpanded
    {
        get => _isExpanded;
        set
        {
            if (_isExpanded == value) return;
            _isExpanded = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsExpanded)));
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}

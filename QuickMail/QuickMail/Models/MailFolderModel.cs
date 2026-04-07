using System;

namespace QuickMail.Models;

public class MailFolderModel
{
    public Guid AccountId { get; set; }
    public bool IsHeader { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int UnreadCount { get; set; }

    /// <summary>Accessibility label: headers just show the name; folders include unread count.</summary>
    public string AutomationName =>
        IsHeader ? DisplayName
        : UnreadCount > 0 ? $"{DisplayName}, {UnreadCount} unread"
        : DisplayName;

    public override string ToString() =>
        IsHeader ? DisplayName
        : UnreadCount > 0 ? $"{DisplayName} ({UnreadCount})" : DisplayName;
}

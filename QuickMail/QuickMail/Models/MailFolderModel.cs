namespace QuickMail.Models;

public class MailFolderModel
{
    public string FullName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int UnreadCount { get; set; }

    public override string ToString() =>
        UnreadCount > 0 ? $"{DisplayName} ({UnreadCount})" : DisplayName;
}

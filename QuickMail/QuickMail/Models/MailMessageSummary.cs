using System;
using CommunityToolkit.Mvvm.ComponentModel;

namespace QuickMail.Models;

public partial class MailMessageSummary : ObservableObject
{
    public uint UniqueId { get; set; }
    public Guid AccountId { get; set; }
    public string FolderName { get; set; } = string.Empty;
    public string From { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public DateTimeOffset Date { get; set; }

    [ObservableProperty]
    private bool _isRead;

    /// <summary>Display-friendly date: "Today HH:mm" or "dd MMM".</summary>
    public string DateDisplay
    {
        get
        {
            var local = Date.ToLocalTime();
            return local.Date == DateTimeOffset.Now.Date
                ? local.ToString("HH:mm")
                : local.ToString("dd MMM");
        }
    }
}

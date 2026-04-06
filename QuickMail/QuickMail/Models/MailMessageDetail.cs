namespace QuickMail.Models;

public partial class MailMessageDetail : MailMessageSummary
{
    public string To { get; set; } = string.Empty;
    public string Cc { get; set; } = string.Empty;
    public string ReplyTo { get; set; } = string.Empty;
    public string MessageId { get; set; } = string.Empty;
    public string PlainTextBody { get; set; } = string.Empty;
    /// <summary>HTML body from the message, if the sender included one. Preferred over PlainTextBody for display.</summary>
    public string HtmlBody { get; set; } = string.Empty;
}

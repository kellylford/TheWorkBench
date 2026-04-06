using System;

namespace QuickMail.Models;

public class ComposeModel
{
    public Guid AccountId { get; set; }
    public string To { get; set; } = string.Empty;
    public string Cc { get; set; } = string.Empty;
    public string Bcc { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    /// <summary>RFC 2822 Message-ID of the message being replied to.</summary>
    public string? InReplyToMessageId { get; set; }
}

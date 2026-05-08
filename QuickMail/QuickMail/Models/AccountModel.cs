using System;

namespace QuickMail.Models;

public class AccountModel
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string DisplayName { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;

    // IMAP
    public string ImapHost { get; set; } = string.Empty;
    public int ImapPort { get; set; } = 993;
    public bool ImapUseSsl { get; set; } = true;
    public bool ImapAcceptInvalidCert { get; set; } = false;

    // SMTP
    public string SmtpHost { get; set; } = string.Empty;
    public int SmtpPort { get; set; } = 587;
    public bool SmtpUseSsl { get; set; } = false; // STARTTLS on 587
    public bool SmtpAcceptInvalidCert { get; set; } = false;

    /// <summary>Number of body-preview lines shown in accessibility info. 0 = disabled.</summary>
    public int PreviewLines { get; set; } = 3;

    public override string ToString() => DisplayName;
}

using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;

namespace UiaNotifyDemo;

/// <summary>
/// Raises UIA Notification events so screen readers (NVDA, JAWS, Narrator) hear
/// programmatic announcements in a native WPF app.
///
/// WPF's AutomationProperties.LiveSetting fires LiveRegionChanged, which screen
/// readers only handle inside web browsers (HTML aria-live). For desktop apps,
/// RaiseNotificationEvent (UIA 1.1, Windows 10 build 1703+) is the correct API.
/// No JAWS/NVDA SDK, no SAPI, no COM interop required.
/// </summary>
internal static class AccessibilityHelper
{
    // An arbitrary stable string that identifies this app's announcements.
    // Screen readers may use it to suppress duplicate consecutive messages.
    private const string ActivityId = "UiaNotifyDemoAnnouncement";

    /// <summary>
    /// Announces <paramref name="text"/> to the active screen reader.
    /// </summary>
    /// <param name="element">
    ///   Any realized <see cref="UIElement"/> in the window — passing the
    ///   <see cref="Window"/> itself is the simplest choice.
    /// </param>
    /// <param name="text">The string for the screen reader to speak.</param>
    /// <param name="interrupt">
    ///   <see langword="true"/>  — use <see cref="AutomationNotificationProcessing.ImportantMostRecent"/>:
    ///                            interrupts whatever the screen reader is currently saying.<br/>
    ///   <see langword="false"/> — use <see cref="AutomationNotificationProcessing.MostRecent"/>:
    ///                            queues the announcement politely after current speech.
    /// </param>
    public static void Announce(UIElement element, string text, bool interrupt = false)
    {
        if (string.IsNullOrEmpty(text)) return;

        // Get or create the UIA peer for the element.
        var peer = UIElementAutomationPeer.FromElement(element)
                   ?? UIElementAutomationPeer.CreatePeerForElement(element);
        if (peer == null) return;

        var processing = interrupt
            ? AutomationNotificationProcessing.ImportantMostRecent
            : AutomationNotificationProcessing.MostRecent;

        peer.RaiseNotificationEvent(
            AutomationNotificationKind.Other,
            processing,
            text,
            ActivityId);
    }
}

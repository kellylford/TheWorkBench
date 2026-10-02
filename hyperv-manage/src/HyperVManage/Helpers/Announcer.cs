using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;

namespace HyperVManage.Helpers;

/// <summary>
/// Speaks text through the screen reader with a UI Automation notification, the standard way for
/// an app to report something that happened away from the focus (an operation finishing, a line
/// of the creation script). Used only for that: what a control already reports, such as a check
/// box toggling or the list selection moving, is left to the screen reader.
/// </summary>
public static class Announcer
{
    public static void Announce(UIElement source, string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        var peer = UIElementAutomationPeer.FromElement(source) ?? UIElementAutomationPeer.CreatePeerForElement(source);
        peer?.RaiseNotificationEvent(
            AutomationNotificationKind.ActionCompleted,
            // Each announcement queues behind the one before, so a run of script lines is heard in full.
            AutomationNotificationProcessing.All,
            text,
            "HyperVManage.Status");
    }
}

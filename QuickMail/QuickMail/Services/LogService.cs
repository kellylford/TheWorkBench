using System;
using System.IO;

namespace QuickMail.Services;

/// <summary>
/// Simple append-only file logger. Log is written to %AppData%\QuickMail\quickmail.log.
/// </summary>
public static class LogService
{
    private static readonly string LogFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "QuickMail", "quickmail.log");

    public static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogFile)!);
            File.AppendAllText(LogFile, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}  {message}{Environment.NewLine}");
        }
        catch { /* never crash on logging */ }
    }

    public static void Log(string context, Exception ex) =>
        Log($"[ERROR] {context}: {ex.GetType().Name}: {ex.Message}");
}

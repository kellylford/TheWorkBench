using System.Net;
using System.Text.RegularExpressions;

namespace HyperVManage.Services;

/// <summary>
/// Windows PowerShell, with its output captured, writes some of what goes to its error stream as
/// CLIXML: a "#&lt; CLIXML" line, then XML holding progress records (such as "Preparing modules
/// for first use") and error text. This turns that back into the plain lines a person, and a
/// screen reader, should get: progress is dropped, and each error, warning or information line
/// comes out as its own text.
/// </summary>
public static partial class CliXml
{
    [GeneratedRegex("""<S S="(?:Error|Warning|Information|Verbose|Debug)">(.*?)</S>""", RegexOptions.Singleline)]
    private static partial Regex Text();

    [GeneratedRegex("_x([0-9A-Fa-f]{4})_")]
    private static partial Regex Escaped();

    /// <summary>The plain lines in one line of PowerShell's error stream.</summary>
    public static IEnumerable<string> Lines(string line)
    {
        if (line.Trim() == "#< CLIXML") yield break;
        if (!line.TrimStart().StartsWith("<Objs", StringComparison.Ordinal))
        {
            yield return line;
            yield break;
        }
        foreach (Match m in Text().Matches(line))
        {
            var text = Decode(m.Groups[1].Value).TrimEnd('\r', '\n');
            foreach (var part in text.Split('\n'))
            {
                var clean = part.TrimEnd('\r');
                if (clean.Trim().Length > 0) yield return clean;
            }
        }
    }

    /// <summary>All of PowerShell's error stream, as plain text.</summary>
    public static string Clean(string stderr) =>
        string.Join("\n", stderr.Split('\n').SelectMany(l => Lines(l.TrimEnd('\r')))).Trim();

    private static string Decode(string xmlText) =>
        Escaped().Replace(WebUtility.HtmlDecode(xmlText), m => ((char)Convert.ToInt32(m.Groups[1].Value, 16)).ToString());
}

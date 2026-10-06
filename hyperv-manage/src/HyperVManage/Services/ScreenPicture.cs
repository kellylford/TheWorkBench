using System.Buffers.Binary;
using System.IO;
using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace HyperVManage.Services;

/// <summary>A picture of a VM's screen, as a PNG file's bytes, and when it was taken.</summary>
public sealed record ScreenPicture(byte[] Png, int Width, int Height, DateTime Taken)
{
    /// <summary>Every pixel the same color: most often a VM whose display has gone to sleep.
    /// Said in words, so nobody needs a picture description to find out there's nothing to see.</summary>
    public bool IsBlank { get; init; }

    /// <summary>What was on screen in words, for a picture of someone's session inside the VM.
    /// Null for Hyper-V's picture of the VM's own screen.</summary>
    public ScreenInfo? Info { get; init; }

    /// <summary>For Hyper-V's picture: why it isn't of the session, when one was wanted.</summary>
    public string Note { get; init; } = "";

    /// <summary>How the picture's name and the status bar describe a blank one.</summary>
    public const string BlankNote = "blank, the whole screen is one color";

    /// <summary>The picture for an Image control. Frozen, so any thread can use it.</summary>
    public BitmapSource ToBitmap()
    {
        var image = new BitmapImage();
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.StreamSource = new MemoryStream(Png);
        image.EndInit();
        image.Freeze();
        return image;
    }

    /// <summary>
    /// What Hyper-V's GetVirtualSystemThumbnailImage returns, made into a PNG: 16-bit RGB565
    /// pixels, row after row with no padding. On Windows 11 they come after a 4-byte header, the
    /// whole array's length as a big-endian number; it is only dropped when it says exactly that,
    /// so data without one is used as it is.
    /// </summary>
    internal static ScreenPicture FromRgb565(byte[] data, int width, int height, DateTime taken)
    {
        if (width <= 0 || height <= 0) throw new HyperVException($"Hyper-V gave a picture with no size ({width} by {height}).");
        var pixelBytes = width * height * 2;
        var offset = data.Length == pixelBytes + 4 && BinaryPrimitives.ReadUInt32BigEndian(data) == (uint)data.Length ? 4
            : data.Length == pixelBytes ? 0
            : throw new HyperVException($"Hyper-V gave {data.Length} bytes for a {width} by {height} picture, which doesn't fit.");

        var raw = data.AsSpan(offset, pixelBytes);
        var blank = raw.Length <= 2 || System.Runtime.InteropServices.MemoryMarshal.Cast<byte, ushort>(raw)[1..]
            .IndexOfAnyExcept(System.Runtime.InteropServices.MemoryMarshal.Cast<byte, ushort>(raw)[0]) < 0;
        var pixels = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgr565, null, raw.ToArray(), width * 2);
        // 24-bit, so every program that opens or pastes it reads it the same way.
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(new FormatConvertedBitmap(pixels, PixelFormats.Bgr24, null, 0)));
        using var png = new MemoryStream();
        encoder.Save(png);
        return new ScreenPicture(png.ToArray(), width, height, taken) { IsBlank = blank };
    }

    /// <summary>Reads the JSON the screenshot script writes: Width, Height and the pixels in base64.</summary>
    internal static ScreenPicture Parse(string json, DateTime taken)
    {
        using var doc = JsonDocument.Parse(PowerShellHyperVService.NonEmpty(json));
        var e = doc.RootElement;
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty("Data", out var data) || data.ValueKind != JsonValueKind.String)
            throw new HyperVException("Hyper-V didn't give a picture of the screen.");
        return FromRgb565(data.GetBytesFromBase64(), (int)PowerShellHyperVService.Num(e, "Width"), (int)PowerShellHyperVService.Num(e, "Height"), taken);
    }
}

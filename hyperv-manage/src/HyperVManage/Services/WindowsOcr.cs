using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace HyperVManage.Services;

/// <summary>
/// Reads the text in a picture with Windows' own text recognition (Windows.Media.Ocr), on this PC:
/// nothing is sent anywhere. It reads in the first of the user's Windows languages that has
/// recognition installed.
/// </summary>
public static class WindowsOcr
{
    /// <summary>The lines of text found, top to bottom; empty when there are none.</summary>
    public static async Task<IReadOnlyList<string>> ReadLinesAsync(byte[] png, CancellationToken ct = default)
    {
        var engine = OcrEngine.TryCreateFromUserProfileLanguages()
            ?? throw new InvalidOperationException(
                "Windows has no text recognition for your languages. It comes with a language's optical character " +
                "recognition feature, in Settings, Time & language, Language & region.");

        using var stream = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(stream))
        {
            writer.WriteBytes(png);
            await writer.StoreAsync().AsTask(ct);
            writer.DetachStream();
        }
        stream.Seek(0);
        var decoder = await BitmapDecoder.CreateAsync(stream).AsTask(ct);

        // Recognition has a size limit; a larger picture is scaled down to fit, keeping its shape.
        var max = OcrEngine.MaxImageDimension;
        var scale = Math.Min(1.0, Math.Min((double)max / decoder.PixelWidth, (double)max / decoder.PixelHeight));
        var transform = new BitmapTransform
        {
            ScaledWidth = (uint)Math.Max(1, Math.Floor(decoder.PixelWidth * scale)),
            ScaledHeight = (uint)Math.Max(1, Math.Floor(decoder.PixelHeight * scale)),
            InterpolationMode = BitmapInterpolationMode.Fant,
        };
        using var bitmap = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied,
            transform, ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage).AsTask(ct);
        var result = await engine.RecognizeAsync(bitmap).AsTask(ct);
        return result.Lines.Select(l => l.Text).Where(t => !string.IsNullOrWhiteSpace(t)).ToList();
    }
}

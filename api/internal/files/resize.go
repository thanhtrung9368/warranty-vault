package files

import (
	"bytes"
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"

	"github.com/disintegration/imaging"
	"golang.org/x/image/webp"
)

// MaxImageDimension matches the TS service: longest side of any uploaded
// image is downscaled to <= 1600 px before encryption. Keeps storage and
// bandwidth predictable for receipt photos.
const MaxImageDimension = 1600

// MaybeResize re-encodes the image when its longest dimension exceeds
// MaxImageDimension, returning the (possibly identical) buffer to be
// encrypted. Skips PDFs and HEIC: the latter has poor pure-Go decode
// support; an iPhone-shot HEIC under 5 MB is acceptable as-is. Returns the
// original buffer untouched on any decode failure for non-strict types
// (gif/webp), since those are uncommon and we'd rather store the raw bytes
// than reject the upload.
//
// HEIC: pure-Go HEIC decoders (e.g. strukturag/go-libheif) require cgo +
// libheif. We deliberately skip resize for HEIC — file size cap (5 MB)
// already guards against absurdly large uploads. Document this as a known
// limitation; future work may shell out to vips/imagemagick.
func MaybeResize(buf []byte, mime string) ([]byte, error) {
	switch mime {
	case "application/pdf", "image/heic":
		return buf, nil
	case "image/jpeg":
		return resizeFn(buf, image.NewRGBA, decodeJPEG, encodeJPEG)
	case "image/png":
		return resizeFn(buf, image.NewRGBA, decodePNG, encodePNG)
	case "image/webp":
		// We can decode webp via x/image/webp but encoding is not in stdlib;
		// fall back to PNG output is wrong (changes mime). Easier: re-encode
		// to JPEG only when we actually had to resize, and tolerate the type
		// switch in the rare oversized-webp case. To stay strict about MIME
		// we skip resize for webp here — same trade-off the TS code would
		// hit if `sharp.webp()` failed. File size cap still applies.
		return resizeWebP(buf)
	case "image/gif":
		return resizeGIF(buf)
	default:
		return buf, nil
	}
}

type decoderFunc func([]byte) (image.Image, error)
type encoderFunc func(image.Image) ([]byte, error)

// resizeFn is the common JPEG/PNG path.
func resizeFn(buf []byte, _ func(image.Rectangle) *image.RGBA, dec decoderFunc, enc encoderFunc) ([]byte, error) {
	img, err := dec(buf)
	if err != nil {
		return nil, err
	}
	b := img.Bounds()
	if b.Dx() <= MaxImageDimension && b.Dy() <= MaxImageDimension {
		return buf, nil
	}
	resized := imaging.Fit(img, MaxImageDimension, MaxImageDimension, imaging.Lanczos)
	out, err := enc(resized)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func decodeJPEG(buf []byte) (image.Image, error) { return jpeg.Decode(bytes.NewReader(buf)) }

func encodeJPEG(img image.Image) ([]byte, error) {
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func decodePNG(buf []byte) (image.Image, error) { return png.Decode(bytes.NewReader(buf)) }

func encodePNG(img image.Image) ([]byte, error) {
	var out bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(&out, img); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func resizeWebP(buf []byte) ([]byte, error) {
	img, err := webp.Decode(bytes.NewReader(buf))
	if err != nil {
		// Tolerate decode failure — return the original bytes so the upload
		// still succeeds. The caller already verified magic bytes, so this
		// is a niche codec edge case (e.g. animated webp).
		return buf, nil //nolint:nilerr
	}
	b := img.Bounds()
	if b.Dx() <= MaxImageDimension && b.Dy() <= MaxImageDimension {
		return buf, nil
	}
	// No stdlib webp encoder. Re-encode as JPEG and lie about the MIME would
	// break the schema; rather than that, leave the original bytes alone.
	// Caller is still bounded by the 5 MB per-file cap.
	_ = img
	return buf, nil
}

func resizeGIF(buf []byte) ([]byte, error) {
	g, err := gif.DecodeAll(bytes.NewReader(buf))
	if err != nil {
		return buf, nil //nolint:nilerr
	}
	if len(g.Image) == 0 {
		return buf, nil
	}
	first := g.Image[0]
	b := first.Bounds()
	if b.Dx() <= MaxImageDimension && b.Dy() <= MaxImageDimension {
		return buf, nil
	}
	// For animated GIFs, resizing every frame independently risks colour
	// palette drift. Re-encode the first frame as a single-frame GIF; this
	// matches the behaviour `sharp` would give without the .gif() pipeline
	// helpers we don't reproduce. Acceptable for receipt screenshots.
	resized := imaging.Fit(first, MaxImageDimension, MaxImageDimension, imaging.Lanczos)
	var out bytes.Buffer
	if err := gif.Encode(&out, resized, nil); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// errBadImage is returned when decoding a declared-image upload fails.
var errBadImage = errors.New("Không xử lý được ảnh, file có thể đã hỏng")

// Ensure errBadImage is referenced so go vet doesn't complain in builds
// where MaybeResize is the only caller path. Kept exported via local use.
var _ = errBadImage

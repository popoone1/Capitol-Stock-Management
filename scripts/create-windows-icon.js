const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const imagePath = path.join(__dirname, "..", "assets", "capitol-catering-logo.png");
const iconPath = path.join(__dirname, "..", "assets", "capitol-catering-logo.ico");
const squareLogoPath = path.join(os.tmpdir(), `capitol-logo-icon-${process.pid}.png`);
const powershellScript = `
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile('${imagePath.replaceAll("'", "''")}')
$canvas = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
try {
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scale = [Math]::Min(256 / $source.Width, 256 / $source.Height)
  $width = [int][Math]::Round($source.Width * $scale)
  $height = [int][Math]::Round($source.Height * $scale)
  $graphics.DrawImage($source, [int]((256 - $width) / 2), [int]((256 - $height) / 2), $width, $height)
  $canvas.Save('${squareLogoPath.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $canvas.Dispose()
  $source.Dispose()
}
`;
const result = spawnSync("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-EncodedCommand",
  Buffer.from(powershellScript, "utf16le").toString("base64"),
], { encoding: "utf8" });
if (result.status !== 0) {
  throw new Error(`Could not prepare the supplied logo for a Windows icon: ${result.stderr || result.stdout}`);
}

try {
  const png = fs.readFileSync(squareLogoPath);
  if (png.toString("ascii", 1, 4) !== "PNG" || png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) {
    throw new Error("The Windows icon image must be a valid 256 × 256 PNG.");
  }
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  fs.writeFileSync(iconPath, Buffer.concat([header, png]));
  console.log(`Created Windows icon ${path.relative(path.join(__dirname, ".."), iconPath)} from the supplied logo.`);
} finally {
  fs.rmSync(squareLogoPath, { force: true });
}

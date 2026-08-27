using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

class IconBuilder {
    static void Main() {
        // Create a 32x32 bitmap
        using (Bitmap bmp = new Bitmap(32, 32, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.Clear(Color.Transparent);
                // Draw a simple blue square
                using (Brush brush = new SolidBrush(Color.FromArgb(255, 42, 162, 154))) {
                    g.FillRectangle(brush, 4, 4, 24, 24);
                }
            }
            // Save as PNG
            bmp.Save(@"E:\AI Engineer Story\study-studio\src-tauri\icons\app-icon.png", ImageFormat.Png);
        }
        Console.WriteLine("Created app-icon.png");
    }
}

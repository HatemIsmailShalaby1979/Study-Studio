using System;
using System.Drawing;
using System.Drawing.Imaging;
namespace IconGen { static P { static void Main() { var b = new Bitmap(32, 32); var g = Graphics.FromImage(b); g.Clear(Color.FromArgb(255, 245, 245, 255)); var br = new SolidBrush(Color.FromArgb(255, 42, 162, 154)); g.FillEllipse(br, 6, 6, 20, 20); g.Dispose(); b.Save("E:\AI Engineer Story\study-studio\src-tauri\icons\app-icon.png", ImageFormat.Png); b.Dispose(); } } }
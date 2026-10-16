import os
from PIL import Image, ImageDraw

def main():
    sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192
    }
    base_res = os.path.join("android", "app", "src", "main", "res")
    for folder, px in sizes.items():
        out_d = os.path.join(base_res, folder)
        os.makedirs(out_d, exist_ok=True)
        for name in ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]:
            img = Image.new("RGBA", (px, px), (6, 10, 20, 255))
            draw = ImageDraw.Draw(img)
            cx, cy = px // 2, px // 2
            ro, rm, re_r = int(px * 0.34), int(px * 0.22), int(px * 0.09)
            draw.ellipse([cx - ro, cy - ro, cx + ro, cy + ro], outline=(56, 189, 248, 255), width=max(2, px // 14))
            draw.ellipse([cx - rm, cy - rm, cx + rm, cy + rm], fill=(255, 46, 99, 255))
            draw.ellipse([cx - re_r, cy - re_r, cx + re_r, cy + re_r], fill=(6, 10, 20, 255))
            img.save(os.path.join(out_d, name))
    print("Successfully generated Android launcher icons.")

if __name__ == "__main__":
    main()

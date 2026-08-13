# Brand assets

| File | Purpose |
|---|---|
| `bot-avatar-source.png` | Master artwork, 1254×1254 PNG. Edit or re-export from this. |
| `bot-avatar.jpg` | The published Telegram profile photo: 512×512 baseline JPEG, sRGB. |

## Why these constraints

Telegram's `setMyProfilePhoto` accepts `InputProfilePhotoStatic`, which must be
**JPEG** — a PNG is rejected. The photo is also cropped to a circle everywhere
it appears, and rendered as small as 40 px in a chat list, so the artwork keeps
generous padding and avoids fine detail or text.

## Re-publishing the avatar

The photo cannot be reused by `file_id`; it must be uploaded as a new file.

```sh
curl "https://api.telegram.org/bot<TOKEN>/setMyProfilePhoto" \
  -F 'photo={"type":"static","photo":"attach://av"}' \
  -F 'av=@assets/bot-avatar.jpg;type=image/jpeg'
```

Regenerate the JPEG from the master after any edit:

```sh
python3 -c "from PIL import Image; \
Image.open('assets/bot-avatar-source.png').convert('RGB') \
 .resize((512,512), Image.LANCZOS) \
 .save('assets/bot-avatar.jpg','JPEG',quality=94,optimize=True)"
```

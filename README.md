# Claude Code for Termux

Claude Code เวอร์ชัน native (musl aarch64) สำหรับ Termux บน Android arm64
ไม่มี proxy ในเครื่อง ไม่ต้องมี subscription — ใช้ API key ของคุณเอง

## ติดตั้ง

```bash
pkg update && pkg install -y nodejs curl tar
git clone https://github.com/SpectreWareZ/claude-termux
cd claude-termux
bash install.sh
```

ติดตั้งครั้งแรกจะถาม API key แล้วทดสอบยิงจริงให้เลย ถ้าผ่านจะขึ้น `INSTALL_OK`

## ใช้

```bash
claude                 # เปิดแชท (มีหน้าโหลด)
claude -p "คำถาม"       # ถามครั้งเดียว ไม่มีหน้าโหลด
claude --resume <id>   # ต่อ session เก่า
```

## เปลี่ยน provider / model / key

```bash
claude setup           # ถามตอบทีละขั้น
claude key <KEY>       # ใส่ key ตรง ๆ
claude key --from grexlabs
claude model <MODEL_ID>
claude url <BASE_URL>
claude presets         # ดู provider ที่รองรับ
claude show            # ดู config ปัจจุบัน (key ถูก mask)
claude test            # ยิงทดสอบ 1 ครั้ง จับเวลา
```

## ปรับหน้าโหลด

```bash
CLAUDE_SPLASH_MS=80 claude      # ช้าลง
CLAUDE_SPLASH_HOLD=2000 claude  # ค้างท้ายนานขึ้น
CLAUDE_NO_SPLASH=1 claude       # ปิด
claude splash                   # พรีวิวเดี่ยว
```

## ต้องมี

- Termux (arm64) — Android 8+
- nodejs, curl, tar (`pkg install nodejs curl tar`)
- พื้นที่ว่าง ~400MB
- API key ที่รับ Anthropic wire (`/v1/messages`)

## หมายเหตุ

- `LD_PRELOAD` ของ Termux ชนกับ musl — launcher `unset` ให้อัตโนมัติ
- กดจอเพื่อพิมพ์ได้ เพราะปิด mouse tracking (`CLAUDE_CODE_DISABLE_MOUSE=1`)
- ออกจากแชทแล้วจอจะเหลือแค่ `claude --resume <id>` ของ session นั้น

ffmpeg -y -i "input.mp4" `
    -vf "subtitles='input.zh.ass'" `
    -c:v h264_nvenc -preset p7 -cq 19 -crf 18 -preset medium -pix_fmt yuv420p `
    -c:a aac -movflags +faststart `
    "input.zh.mp4"
    # -t 60 `
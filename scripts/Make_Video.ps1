ffmpeg -y -i "GitHub Copilot deep dive： Model selection, prompting techniques & agent mode [0Oz-WQi51aU].mkv" `
    -vf "subtitles='input.zh.ass'" `
    -c:v h264_nvenc -preset p7 -cq 19 -crf 18 -preset medium -pix_fmt yuv420p `
    -c:a aac -movflags +faststart `
    "input.zh.mp4"
    # -t 60 `
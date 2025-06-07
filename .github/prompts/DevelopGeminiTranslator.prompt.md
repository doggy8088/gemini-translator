---
mode: 'agent'
tools: ['codebase', 'editFiles', 'fetch', 'githubRepo', 'problems', 'runCommands', 'runTasks', 'search', 'searchResults', 'terminalLastCommand', 'terminalSelection', 'usages']
---
You task is to develop a Gemini translator that can translate SRT captions from English to Traditional Chinese (zh-tw).

Reference the REST API spec:

```sh
#!/bin/bash
set -e -E

GEMINI_API_KEY="$GEMINI_API_KEY"
MODEL_ID="gemini-2.5-flash-preview-05-20"
GENERATE_CONTENT_API="streamGenerateContent"

cat << EOF > request.json
{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "INSERT_INPUT_HERE"
          },
        ]
      },
    ],
    "generationConfig": {
      "responseMimeType": "text/plain",
    },
}
EOF

curl \
-X POST \
-H "Content-Type: application/json" \
"https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}" -d '@request.json'
```

You have to read `GEMINI_API_KEY` from the environment variables.

## ARGUMENTS

- `input`: The input SRT file path.
- `output`: The output SRT file path. Defaults to `<inputFilename>.zh.srt`.
- `model`: The model to use for translation. Defaults to `gemini-2.5-flash-preview-05-20`.

## USAGE EXAMPLE

```sh
node main.js --input input.srt --output input.zh.srt
```

## LOGICS

1. Read the input SRT file and extract the captions.
2. A batch translation consists of 10 captions, but this is configurable.
3. Call the Gemini API to translate the text from English to Traditional Chinese (zh-tw).
4. Ensure the number of extracted items matches the number of translation results, as the Gemini API may return an incorrect count.
5. Write the translated captions to the output SRT file, preserving the original timing and formatting.
6. Continue translating the next batch until all captions are translated.
7. After translation, verify that the time codes are in sequential order. If not, produce an error.
8. If the output file is not specified, use the input filename with `.zh.srt` as the extension.

## OUTPUT

You should write `main.js` that implements the above logic. The script should handle reading and writing files, making API requests, and processing the SRT format correctly.

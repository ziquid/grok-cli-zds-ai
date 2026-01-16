#!/usr/bin/env zsh

set -e

# Check for help option
if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
    echo "Usage: joycaption <image_file> [--prompt <prompt_text>]"
    echo
    echo "Generate captions for images using the JoyCaption service."
    echo
    echo "Arguments:"
    echo "  <image_file>     Path to the image file to caption"
    echo "  --prompt         Optional prompt to guide the captioning"
    echo
    echo "Examples:"
    echo "  joycaption image.jpg"
    echo "  joycaption image.png --prompt \"Describe this image in detail\""
    echo
    exit 0
fi

IMAGE="$1"
IMAGE_BASENAME=$(basename "$1" | tr -cs '[:alnum:].' _ | sed -e 's,_+$,,g')
shift

[[ "$2" == --prompt ]] && shift
[[ -n "$2" ]] && IMAGE_PROMPT="--prompt \"$2\""

# send the file to the server
scp "$IMAGE" asrock:scm/joycaption/images/$IMAGE_BASENAME
tmp=$(mktemp /tmp/joycaption.XXXXXX)
ssh asrock "bin/joycaption-receiver $IMAGE_BASENAME $IMAGE_PROMPT" > $tmp 2>/dev/null
grep -A99 '==========' $tmp | grep -v '==========' > ${tmp}.txt
[[ -s ${tmp}.txt ]] && cat ${tmp}.txt || cat ${tmp}
rm -f $tmp

exit 0

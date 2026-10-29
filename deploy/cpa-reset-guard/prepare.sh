#!/bin/sh
set -eu
# Build from an immutable revision, without changing the supplied checkout.
package_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_repo=${1:?Usage: prepare.sh SOURCE_REPOSITORY [NEW_OUTPUT_DIRECTORY]}
output_dir=${2:-"$package_dir/build/prepared"}
baseline=d946c4fba6fc9a5cfbca1f3d85184d62ad2fb683
[ "$(git -C "$source_repo" rev-parse "$baseline^{commit}")" = "$baseline" ]
if [ -e "$output_dir" ]; then echo 'Output directory already exists; choose a fresh directory.' >&2; exit 1; fi
mkdir -p "$output_dir"
git -C "$source_repo" archive "$baseline" | tar -x -C "$output_dir"
(cd "$output_dir" && patch -p1 --batch --forward < "$package_dir/cpa-v8.0.40-reset-guard.patch")
printf 'Prepared %s at %s\n' "$baseline" "$output_dir"

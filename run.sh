#!/usr/bin/env bash
# @terran
# set -e -u
# set -e
trap '{ echo "pressed Ctrl-C.  Time to quit." ; exit 1; }' INT
export PATH="/usr/local/bin:$PATH"

dir=$(
	cd $(dirname $0)
	pwd
)
tmp=$dir/.tmp
mkdir -p $tmp
function error_exit() { echo "【ERROR】::${1:-"Unknown Error"}" 1>&2 && exit 1; }

fb_app_id=27708600165480897
fb_app_name="HexaFade"
fb_token="${FB_UPLOAD_TOKEN:-}"
fb_leaderboard_world="world"

fb_comment="commit"

# 上传凭证只在运行时读取，不写入仓库，也不放进 curl 命令行参数。
require_fb_token() {
	if [ -z "$fb_token" ]; then
		[ -t 0 ] || error_exit "请设置 FB_UPLOAD_TOKEN，或在终端中输入上传令牌"
		read -r -s -p "请输入 Facebook 上传访问令牌：" fb_token
		printf '\n'
	fi
	[ -n "$fb_token" ] || error_exit "上传令牌不能为空"
}

fb_token_config() {
	printf '%s' "$fb_token" | python3 -c 'import json, sys; print("form = " + json.dumps("access_token=" + sys.stdin.read()))'
}

function fbgame() {
	# local upload=false;
	# local debug=false;
	# local target="IG";
	# while [ "$#" -gt 0 ]; do
	# case "$1" in
	# 	-v|--version) version="$2";shift;;
	# 	--version=*) version="${1#*=}";;
	# 	-u|--upload) upload=true;;
	#     -d|--debug) debug=true;;
	#     -t|--target) target="$2";shift;;
	# esac;shift
	# done

	# local line=`cat $dir/version.js`;
	# local v=`echo $line | grep -oE '[0-9]+\.[0-9]+'`
	# if [ -z ${version+x} ]; then
	# 	local array=(${v//./ })
	# 	array[1]=$((${array[1]}+1))
	# 	version="${array[0]}.${array[1]}";
	# 	echo "version absent, auto generate ${version}";
	# fi

	# if [ -z ${version+x} ]; then error_exit "need version";fi

	# line=${line/$v/$version}
	# echo $line > $dir/version.js

	local upload=false
	local debug=false
	local target="IG"

	while [ "$#" -gt 0 ]; do
		case "$1" in
		-v | --version)
			version="$2"
			shift
			;;
		--version=*) version="${1#*=}" ;;
		-u | --upload) upload=true ;;
		-d | --debug) debug=true ;;
		-t | --target)
			target="$2"
			shift
			;;
		esac
		shift
	done

	local line=$(cat $dir/version.js)
	local v=$(echo $line | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')

	if [ -z ${version+x} ]; then
		local array=(${v//./ })
		array[2]=$((${array[2]} + 1))

		if [ ${array[2]} -ge 1000 ]; then
			array[2]=0
			array[1]=$((${array[1]} + 1))

			if [ ${array[1]} -ge 1000 ]; then
				array[1]=0
			fi
		fi

		version="${array[0]}.${array[1]}.${array[2]}"
		echo "version absent, auto generate ${version}"
	fi

	if [ -z ${version+x} ]; then
		error_exit "need version"
	fi

	line=${line/$v/$version}
	echo $line >$dir/version.js

	if [ -z ${version} ]; then
		cat $version_file
		error_exit "need version"
	fi
	echo "Version:$version"

	version=$version

	# perl -pi -e 's|#version#|'${version}'|g' $dir/assets/Script/FBGameConfig.ts
	# perl -pi -e 's/static GameVersion = "[^"]+";/static GameVersion = "'"$version"'";/' $dir/assets/Script/FBGameConfig.ts

	#build
	local CocosCreator=/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/MacOS/CocosCreator
	# 使用工程已有的 HomeScene 启动配置，确保先初始化 SDK 再进入游戏。
	local build_config="$dir/build-templates/buildConfig_web-mobile.json"
	[ -f "$build_config" ] || error_exit "找不到构建配置：$build_config"
	"$CocosCreator" --project "$dir" --build "configPath=$build_config;platform=web-mobile;debug=$debug;mainBundleCompressionType=merge_all_json;"
	local build_status=$?
	[ "$build_status" -eq 36 ] || error_exit "Cocos 构建未成功，退出码：$build_status"

	local dist="$dir/build/web-mobile"
	# 防止覆盖配置后再次跳过 HomeScene，也避免构建失败时打包旧产物。
	python3 - "$dist/src/settings.json" <<'PY_CHECK'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    settings = json.load(source)
expected = "db://assets/Scene/HomeScene.scene"
actual = settings.get("launch", {}).get("launchScene")
if actual != expected:
    raise SystemExit(f"启动场景错误：{actual}；必须为 {expected}")
print("启动场景检查通过：HomeScene")
PY_CHECK
	[ "$?" -eq 0 ] || error_exit "启动场景检查失败，已停止打包"

	# cp ./version.js "${dir}/build/web-mobile/version.js"
	# perl -pi -e 's/window.$GAME_VERSION_CODE = "[^"]+";/window.$GAME_VERSION_CODE = "'"$version"'";/' $dir/build/web-mobile/magic.js
	perl -pi -e "s|#version#|${version}|g" $dist/magic.js

	# compressImages  -c $dist;
	compressMP3s -c $dis

	# for file in `find $dist -name "*.js"`;do
	# 	echo $file;
	# 	uglifyjs -m -c -o $file $file;
	# 	echo "uglify sucess"
	# done

	echo "obfuscator"
	javascript-obfuscator $dist/assets/main/index.js --output $dist/assets/main/index.js --config $dir/obfuscator.json
	javascript-obfuscator $dist/magic.js --output $dist/magic.js --config $dir/obfuscator.json

	rm -rf $dir/game.zip
	(cd $dist && zip -qr $dir/game.zip .)

	if $upload; then
		uploadfb --version $version
	fi
}

upversion() {
	local dist=$dir/build/web-mobile

	echo "version"
	echo $version
	echo $dir

	version="${array[0]}.${array[1]}.${array[2]}"
	echo "version absent, auto generate ${version}"

	perl -pi -e "s|#version#|${version}|g" $dist/version.js
	perl -pi -e "s|#version#|${version}|g" $dist/magic.js

	# perl -pi -e 's/var GameVersion = "[^"]+";/var GameVersion = "'"$version"'";/' $dist/version.js
	# perl -pi -e 's/var GameVersion = "[^"]+";/var GameVersion = "'"$version"'";/' $dist/magic.js

	# perl -pi -e 's/window.$GAME_VERSION_CODE = "[^"]+";/window.$GAME_VERSION_CODE = "'"$version"'";/' $dist/version.js
	# perl -pi -e 's/window\.\$GAME_VERSION_CODE = "[^"]+";/window.$GAME_VERSION_CODE = "'"$version"'";/' $dist/version.js

	# echo perl -pi -e 's/window\.\$GAME_VERSION_CODE = "[^"]+";/window.$GAME_VERSION_CODE = "'"$version"'";/' $dist/version.js

}

deletebin() {
	local dist=$dir/build/web-mobile/assets/resources
	for file in $(find $dist -name "*.bin"); do
		rm -f $file
		echo $file
	done
}

deleteempty() {
	local dist=$dir/build/web-mobile/assets/resources/native
	for file in $dist/*; do
		count=$(ls $file | wc -w)
		if [ $count == 0 ]; then
			rm -rf $file
		fi
	done
}

json() {
	local json=$dir/build/web-mobile/assets/resources
	echo "json ...."
	(cd build/web-mobile/assets/resources/import && zip -qr $dir/build/web-mobile/assets/resources/import.zip .)
}

uploadfb() {
	local version=""
	while [ "$#" -gt 0 ]; do
		case "$1" in
		-v | --version)
			version="$2"
			shift
			;;
		--version=*) version="${1#*=}" ;;
		*) version="$1" ;;
		esac
		shift
	done
	require_fb_token
	echo "uploading ...."
	# export ALL_PROXY=socks5://127.0.0.1:1086
	# --socks5 127.0.0.1:1086 \
	export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890
	# export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 all_proxy=socks5://127.0.0.1:7897
	# export http_proxy=http://127.0.0.1:1087;export https_proxy=http://127.0.0.1:1087;
	local comment=$fb_comment
	fb_token_config | curl --config - -X POST "https://graph-video.facebook.com/$fb_app_id/assets" \
		--progress-bar \
		-F 'type=BUNDLE' \
		-F "asset=@$dir/game.zip" \
		-F "comment=#${version}# ${comment}" || error_exit "upload post failed"
}

function createLeaderboad() {
	require_fb_token


	local nameSuffix="level_l"
	for index in {1..200}; do
		local name=${nameSuffix}_${index}
		echo "leadborad ${name} creating ..."
		fb_token_config | curl --config - -X POST "https://graph.facebook.com/$fb_app_id/leaderboards_create" \
			--progress-bar \
			--socks5 127.0.0.1:1086 \
				-F "name=${name}" \
			-F "decimal_offset=1" \
			-F "score_type=NUMERIC" \
			-F "sort_order=LOWER_IS_BETTER" || error_exit "create leadboradfailed"
		echo " "
		sleep 3s
		echo "leadborad ${name} created"
	done
}

function compressImages() {
	local cache=false
	local path
	while [ "$#" -gt 0 ]; do
		case "$1" in
		-c | --cache) cache=true ;;
		--cache=*) cache="${1#*=}" ;;
		*) path="$1" ;;
		esac
		shift
	done

	local cache_dir=$tmp/imageCache
	mkdir -p $cache_dir
	for file in $(find $path -name "*.png" -o -name "*.jpg"); do
		if $cache; then
			local fileMD5=$(md5 -q ${file})
			local cache_file=$cache_dir/$fileMD5
			if [[ -e $cache_file ]]; then
				cp -f $cache_file $file
				continue
			fi
		fi
		if [[ $file == *.png ]]; then #--quality 50-80
			local color=512
			if [[ $file == */ani/* ]]; then color=256; fi
			/usr/local/pngquant/pngquant/pngquant --ext ".png" --skip-if-larger --strip --force $color $file
			# /usr/local/pngquant/pngquant/pngquant --ext ".png" --skip-if-larger --strip --force --quality=65-80 $file
		elif [[ $file == *.jpg ]]; then
			/usr/local/jpegoptim-master./configure -s -m60 -q $file
		fi

		if $cache; then cp -fv $file $cache_file; fi
	done
	echo "image compress finished!"
}

function compressMP3s() {
	local cache=false
	local path
	while [ "$#" -gt 0 ]; do
		case "$1" in
		-c | --cache) cache=true ;;
		--cache=*) cache="${1#*=}" ;;
		*) path="$1" ;;
		esac
		shift
	done

	local cache_dir=$tmp/mp3Cache
	mkdir -p $cache_dir
	for file in $(find $path -name "*.mp3"); do
		local fileMD5=$(md5 -q ${file})
		local cache_file=$cache_dir/$fileMD5
		if [[ -e $cache_file ]]; then
			cp -f $cache_file $file
		else
			lame --silent --abr 48 --resample 44.1 "${file}" $tmp/mp3 && mv $tmp/mp3 "${file}"
			if $cache; then cp -fv $file $cache_file; fi
		fi
	done
	echo "mp3 compress finished!"
}

complies() {
	curl http://localhost:7456/asset-db/refresh
}

function testfb() {
	cd build/web-mobile
	local path="."
	while [ "$#" -gt 0 ]; do
		case "$1" in
		*) path="$1" ;;
		esac
		shift
	done
	echo https://www.facebook.com/embed/instantgames/$fb_app_id/player?game_url=https://localhost:8080
	local key=$dir/key
	http-server $path -S -C $key/cert.pem -K $key/key.pem -c1
}

if test $# -lt 1; then error_exit "wrong arguments"; fi
cmd=$1 && shift
echo $cmd $@
$cmd $@

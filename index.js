// 项目名，决定html从哪个项目获取，
const github_repo = typeof(GITHUB_REPO)!="undefined" ? GITHUB_REPO
    : 'woniu336/Url-Shorten-Worker'
// 项目版本，cdn会有缓存，所以有更新时需要指定版本，
const github_version = typeof(GITHUB_VERSION)!="undefined" ? GITHUB_VERSION
    : '@main'
// 密码，密码正确情况无视白名单和超时设置，且支持自定义短链接，
const password = typeof(PASSWORD)!="undefined" ? PASSWORD
    : 'BricRoot'
// 短链超时，单位毫秒，支持整数乘法，0表示不设置超时，
const shorten_timeout = typeof(SHORTEN_TIMEOUT)!="undefined" ? SHORTEN_TIMEOUT.split("*").reduce((a,b)=>parseInt(a)*parseInt(b),1)
    : '0'
// 默认短链key的长度，遇到重复时会自动延长，
const default_len = typeof(DEFAULT_LEN)!="undefined" ? parseInt(DEFAULT_LEN)
    : 6
// 为true开启演示，否则无密码且非白名单请求不受理，是则允许访客试用，超时后失效，
const demo_mode = typeof(DEMO_MODE)!="undefined" ? DEMO_MODE === 'true'
    : true
// 为true自动删除超时的演示短链接记录，否则仅是标记过期，以便在后台查询历史记录，
const remove_completely = typeof(REMOVE_COMPLETELY)!="undefined" ? REMOVE_COMPLETELY === 'true'
    : true
// 白名单中的域名无视超时，json数组格式，写顶级域名就可以，自动通过顶级域名和所有二级域名，
const white_list = JSON.parse(typeof(WHITE_LIST)!="undefined" ? WHITE_LIST
    : `[
""
    ]`)
// 演示模式开启时网页上展示这段禁止滥用提示，并不需要明确表示什么时候失效，
const demo_notice = typeof(DEMO_NOTICE)!="undefined" ? DEMO_NOTICE
    : `提示: 本站点所生成的链接与本人没有任何关系，想要自己搭建？<a href="https://github.com/AoEiuV020/Url-Shorten-Worker">点击转跳源代码</a>`
//console.log(`${github_repo}, ${github_version}, ${password}, ${shorten_timeout}, ${demo_mode}, ${white_list}, ${demo_notice}`)
const html404 = `<!DOCTYPE html>
<body>
  <h1>404 Not Found.</h1>
  <p>The url you visit is not found.</p>
</body>`


async function randomString(len) {
  　　let $chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';    /****默认去掉了容易混淆的字符oOLl,9gq,Vv,Uu,I1****/
  　　let maxPos = $chars.length;
　　let result = '';
　　for (i = 0; i < len; i++) {
　　　　result += $chars.charAt(Math.floor(Math.random() * maxPos));
　　}
　　return result;
}
async function checkURL(url){
    let str=url;
    let Expression=/^http(s)?:\/\/(.*@)?([\w-]+\.)*[\w-]+([_\-.,~!*:#()\w\/?%&=]*)?$/;
    let objExp=new RegExp(Expression);
    if(objExp.test(str)==true){
      if (str[0] == 'h')
        return true;
      else
        return false;
    }else{
        return false;
    }
} 
// 检查域名是否在白名单中，参数只包含域名部分，
async function checkWhite(host){
    return white_list.some((h) => host == h || host.endsWith('.'+h))
} 
async function md5(message) {
  const msgUint8 = new TextEncoder().encode(message) // encode as (utf-8) Uint8Array
  const hashBuffer = await crypto.subtle.digest('MD5', msgUint8) // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer)) // convert buffer to byte array
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('') // convert bytes to hex string

  return hashHex
}
async function checkHash(url, hash) {
    if (!hash) {
        return false
    }
    return (await md5(url+password)) == hash
}
async function save_url(url, key, admin, len) {
　　len = len || default_len;
    // 密码正确且指定了key的情况直接覆盖旧值，
    const override = admin && key
    if (!override) {
        // 密码不正确情况无视指定key,
        key = await randomString(len)
    }
    const is_exists = await load_url(key)
    console.log("key exists " + key + " " + is_exists)
    if (override || !is_exists) {
        var mode = 3
        if (admin) {
            mode = 0
        }
        let value = `${mode};${Date.now()};${url}`
        if (remove_completely && mode != 0 && !await checkWhite(new URL(url).host)) {
          // 利用expirationTtl实现过期记录自动删除，低于60秒会报错，
          let ttl = Math.max(60, shorten_timeout / 1000)
          console.log("key auto remove: " + key + ", " + ttl + "s")
          return await LINKS.put(key, value, {expirationTtl: ttl}),key
        } else {
          return await LINKS.put(key, value),key
        }
    } else {
        return await save_url(url, key, admin, len + 1)
    }
}
async function load_url(key) {
    const value = await LINKS.get(key)
    if (!value) {
        return null
    }
    const list = value.split(';')
    console.log("value split " + list)
    var url
    if (list.length == 1) {
        // 老数据暂且正常跳转，
        url = list[0]
    } else {
        url = list[2]
        const mode = parseInt(list[0])
        const create_time = parseInt(list[1])
        if (mode != 0 && shorten_timeout > 0
            && Date.now() - create_time > shorten_timeout) {
            const host = new URL(url).host
            if (await checkWhite(host)) {
                console.log('white list')
            } else {
                // 超时和找不到做同样的处理，
                console.log("shorten timeout")
                return null
            }
        }
    }
    return url
}
async function handleRequest(request) {
  console.log(request)
  if (request.method === "POST") {
    let req=await request.json()
    console.log("url " + req["url"])
    let admin = await checkHash(req["url"], req["hash"])
    console.log("admin " + admin)
    if(!await checkURL(req["url"]) || (!admin && !demo_mode && !await checkWhite(new URL(req["url"]).host))){
    // 非演示模式下，非白名单地址当成地址不合法处理，
    return new Response(`{"status":500,"key":": Error: Url illegal."}`, {
      headers: {
      "content-type": "text/html;charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods": "POST",
      },
    })}
    let stat,random_key=await save_url(req["url"], req["key"], admin)
    console.log("stat " + stat)
    if (typeof(stat) == "undefined"){
      return new Response(`{"status":200,"key":"/`+random_key+`"}`, {
      headers: {
      "content-type": "text/html;charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods": "POST",
      },
    })
    }else{
      return new Response(`{"status":200,"key":": Error:Reach the KV write limitation."}`, {
      headers: {
      "content-type": "text/html;charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods": "POST",
      },
    })}
  }else if(request.method === "OPTIONS"){  
      return new Response(``, {
      headers: {
      "content-type": "text/html;charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods": "POST",
      },
    })

  }

  const requestURL = new URL(request.url)
  const path = requestURL.pathname.split("/")[1]
  console.log(path)
  if(!path){

    const html= await fetch(`https://cdn.jsdelivr.net/gh/${github_repo}${github_version}/index.html`)
    const text = (await html.text())
        .replaceAll("###GITHUB_REPO###", github_repo)
        .replaceAll("###GITHUB_VERSION###", github_version)
        .replaceAll("###DEMO_NOTICE###", demo_notice)
    
    return new Response(text, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
    },
  })
  }
  const url = await load_url(path)
  if (!url) {
    // 找不到或者超时直接404,
    console.log('not found')
    return new Response(html404, {
      headers: {
        "content-type": "text/html;charset=UTF-8",
      },
      status: 404
    })
  }
  return Response.redirect(url, 302)
}



addEventListener("fetch", async event => {
  event.respondWith(handleRequest(event.request))
})

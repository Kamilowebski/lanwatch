function forbidden(message){throw Object.assign(new Error(message),{status:403});}
function sameOrigin(value,authority){try{const url=new URL(value);return url.protocol==='http:'&&url.origin===new URL('http://'+authority).origin&&!url.username&&!url.password;}catch{return false;}}
function validateLocalRequest(request,port){
 const authority=request.headers.host;
 const hostCount=request.rawHeaders?.filter((value,index)=>index%2===0&&value.toLowerCase()==='host').length;
 if(hostCount!==undefined&&hostCount!==1)forbidden('Wymagany pojedynczy lokalny nagłówek Host.');
 const match=typeof authority==='string'&&/^(localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$/i.exec(authority);
 if(!match||Number(match[2]||80)!==port)forbidden('Dozwolony Host: localhost lub 127.0.0.1 z portem aplikacji.');
 if(typeof request.url!=='string'||!request.url.startsWith('/')||request.url.startsWith('//'))throw Object.assign(new Error('Nieprawidłowy adres żądania.'),{status:400});
 if(!['GET','HEAD'].includes(request.method)){
  const origin=request.headers.origin,site=request.headers['sec-fetch-site'];
  if(origin!==undefined&&!sameOrigin(origin,authority))forbidden('Żądanie pochodzi z innej witryny.');
  if(site!==undefined&&site!=='same-origin')forbidden('Żądanie pochodzi z innej witryny.');
  if(origin===undefined&&request.headers.referer!==undefined&&!sameOrigin(request.headers.referer,authority))forbidden('Żądanie pochodzi z innej witryny.');
 }
}
function setSecurityHeaders(response){
 response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'");
 response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('X-Frame-Options','DENY');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Cross-Origin-Resource-Policy','same-origin');
}
function parseBoundedJson(body,maxDepth=64){
 let depth=0,quoted=false,escaped=false;
 for(const char of body){if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}else if(char==='"')quoted=true;else if(char==='{'||char==='['){if(++depth>maxDepth)throw Object.assign(new Error('Zbyt głęboko zagnieżdżony JSON (limit 64).'),{status:400});}else if(char==='}'||char===']')depth--;}
 try{return JSON.parse(body);}catch{throw Object.assign(new Error('Nieprawidłowy format JSON.'),{status:400});}
}
module.exports={validateLocalRequest,setSecurityHeaders,parseBoundedJson,sameOrigin};

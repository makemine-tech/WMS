/* ============================================================
   AI 물류비서 — 비서 화면에서 입력한 로그인 값을 상시 컴퓨터로 안전하게 전달 (브라우저·Node 공용, 2026-11-02)

   헤드비서가 탭을 켤 때마다 새 키 쌍을 만들어 공개키만 secretary/loginKey 에 올린다. 개인키는 꺼낼 수 없게 만들어 메모리에만 둔다.
   화면은 공개키로 잠가 secretary/loginreq 에 넣고, 헤드비서는 받자마자 지운 뒤 풀어서 한 번 쓰고 버린다.
   값은 어디에도 저장하지 않는다. Firebase 에는 풀 수 없는 글자만 잠깐 지나간다.
============================================================ */
(function(root){
  'use strict';
  var ALG = { name: 'RSA-OAEP', hash: 'SHA-256' };
  var MAX_BYTES = 190;   /* RSA-2048 + SHA-256 으로 한 번에 잠글 수 있는 크기 */
  var subtle = function(){ return root.crypto.subtle; };

  function toB64(buf){ return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function fromB64(s){ return Uint8Array.from(atob(s), function(c){ return c.charCodeAt(0); }); }

  /* 개인키 extractable = false: 코드로도 꺼낼 수 없음 */
  function createKeys(){
    return subtle().generateKey(Object.assign({ modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, ALG), true, ['encrypt', 'decrypt']).then(function(pair){
      return subtle().exportKey('jwk', pair.publicKey).then(function(jwk){
        return subtle().exportKey('pkcs8', pair.privateKey).then(function(raw){
          return subtle().importKey('pkcs8', raw, ALG, false, ['decrypt']).then(function(priv){ return { publicJwk: jwk, privateKey: priv }; });
        });
      });
    });
  }
  function seal(publicJwk, creds){
    var bytes = new TextEncoder().encode(JSON.stringify(creds));
    if (bytes.length > MAX_BYTES) return Promise.reject(new Error('입력한 값이 너무 깁니다'));
    return subtle().importKey('jwk', publicJwk, ALG, false, ['encrypt']).then(function(key){
      return subtle().encrypt(ALG, key, bytes);
    }).then(toB64);
  }
  function unseal(privateKey, sealed){
    return subtle().decrypt(ALG, privateKey, fromB64(sealed)).then(function(buf){ return JSON.parse(new TextDecoder().decode(buf)); });
  }

  var API = { createKeys: createKeys, seal: seal, unseal: unseal };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SECRETARY_LOGIN = API;
})(typeof window !== 'undefined' ? window : globalThis);

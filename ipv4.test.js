const test=require('node:test');
const assert=require('node:assert/strict');
const {isValidIPv4}=require('./public/ipv4');
test('IPv4 validator accepts dotted decimal and rejects IPv6, malformed and ambiguous addresses',()=>{
 for(const ip of ['0.0.0.0','255.255.255.255','192.168.1.10','10.0.0.1','172.16.0.1'])assert.equal(isValidIPv4(ip),true,ip);
 for(const ip of ['','192.168.1.999','192.168.1','192.168..1','192.168.1.1.1','192.168.001.1','-1.1.1.1','1e2.1.1.1','192.168.1.1/24','192.168.1.1:22','host','::1','fd12::1','::ffff:192.168.1.1','192.168.1.1%eth0',' 192.168.1.1','1.2.3.4\n'])assert.equal(isValidIPv4(ip),false,ip);
});

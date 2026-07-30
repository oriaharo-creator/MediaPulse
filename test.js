async function testEsm() {
    try {
        const res = await fetch('https://esm.sh/@distube/ytdl-core?bundle');
        const text = await res.text();
        console.log(text.substring(0, 1000));
    } catch(e) {
        console.log("Failed", e.message);
    }
}
testEsm();

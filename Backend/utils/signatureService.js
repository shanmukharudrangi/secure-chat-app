const crypto = require("crypto");

exports.signMessage = (message, privateKey) => {
  const signer = crypto.createSign("SHA256");
  signer.update(message);
  signer.end();
  return signer.sign(privateKey, "hex");
};

exports.verifySignature = (message, signature, publicKey) => {
  try {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(message);
    verifier.end();
    return verifier.verify(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      },
      signature,
      "hex"
    );
  } catch (err) {
    console.error("Signature verification error:", err.message);
    return false;
  }
};

(function () {
  "use strict";

  var MODE_PREFIXES = {
    "SL3": "188704",
    "SRG": "324700",
    "PML": "323700",
    "BYS": "302700",
    "KM8/9": "186115"
  };

  function pad2(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) n = 0;
    n = (n % 100 + 100) % 100;
    return (n < 10) ? ("0" + n) : String(n);
  }

  function digitsOnly(val) {
    return String(val || "").replace(/\D/g, "");
  }

  function stripKnownLocationPrefix(digits) {
    if (!digits) return "";
    var prefKeys = ["SL3", "SRG", "PML", "BYS", "KM8/9"];
    for (var i = 0; i < prefKeys.length; i++) {
      var p = MODE_PREFIXES[prefKeys[i]];
      if (p && digits.indexOf(p) === 0) return digits.substring(p.length);
    }
    return digits;
  }

  function force4DigitsSuffix(d) {
    d = String(d || "");
    if (!d) return "";
    if (d.length > 4) d = d.slice(-4);
    while (d.length < 4) d = "0" + d;
    return d;
  }

  function normalizePOWithMode(mode, raw) {
    var m = mode || "std";
    var digits = digitsOnly(raw);
    if (!digits) return "";

    digits = stripKnownLocationPrefix(digits);
    if (!digits) return "";

    if (m === "std") {
      var y = new Date().getFullYear() % 100;
      var yr = pad2(y);
      var prev1 = pad2(y - 1);
      var prev2 = pad2(y - 2);

      if (digits.length === 6) {
        var head2 = digits.substring(0, 2);
        if (head2 === yr || head2 === prev1 || head2 === prev2) {
          return "2030" + head2 + "00" + digits.substring(2);
        }
        return digits;
      } else if (digits.length === 4) {
        return "2030" + yr + "00" + digits;
      }
      return digits;
    }

    var prefix = MODE_PREFIXES[m] || "";
    if (!prefix) return digits;

    digits = force4DigitsSuffix(digits);
    return prefix + digits;
  }

  window.SMGNormalizer = {
    MODE_PREFIXES: MODE_PREFIXES,
    digitsOnly: digitsOnly,
    stripKnownLocationPrefix: stripKnownLocationPrefix,
    force4DigitsSuffix: force4DigitsSuffix,
    normalizePOWithMode: normalizePOWithMode
  };
})();

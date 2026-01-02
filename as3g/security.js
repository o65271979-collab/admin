/**
 * AS3G Advanced Security Layer - Offensive Mode
 */

(function () {
    // 1. Core UI Protection
    const disableUI = () => {
        document.addEventListener('contextmenu', e => e.preventDefault(), false);
        document.addEventListener('keydown', e => {
            if (e.keyCode === 123 ||
                (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) ||
                (e.ctrlKey && e.keyCode === 85) ||
                (e.ctrlKey && e.keyCode === 83)) {
                e.preventDefault();
                return false;
            }
        });
    };

    // 2. The Offensive Trap
    // This function will crash the browser tab or clear the code if debugging is detected
    const antiDebug = () => {
        const check = function () {
            const start = new Date();
            debugger; // This pauses execution if DevTools is open
            const end = new Date();
            if (end - start > 100) {
                // If paused, we wipe everything IMMEDIATELY
                document.documentElement.innerHTML = "";
                window.location.href = "about:blank"; // Redirect to a blank page
            }
        };

        // Run check constantly
        setInterval(check, 500);

        // Secondary Trap: Anonymous function recursion that halts debugger
        (function () {
            (function a() {
                try {
                    (function b(i) {
                        if (("" + i / i).length !== 1 || i % 20 === 0) {
                            (function () { }).constructor("debugger")();
                        } else {
                            debugger;
                        }
                        b(++i);
                    }(0));
                } catch (e) {
                    setTimeout(a, 500);
                }
            })();
        })();
    };

    // 3. Clear existing sensitive variables from global scope if possible
    const clearTraces = () => {
        // This is a placeholder. Real obfuscation happens in the file itself.
        
    };

    // Initializate
    // disableUI();
    // antiDebug(); // Activate Offensive Mode
    clearTraces();

})();

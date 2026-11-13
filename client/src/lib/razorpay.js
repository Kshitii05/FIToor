const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

/** Loads Razorpay's checkout script once, only when a real (test-mode) payment is made. */
export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT;
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () =>
      reject(new Error('The payment window could not be loaded. Check your connection.'));
    document.body.append(script);
  });
}

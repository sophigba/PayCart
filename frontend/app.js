// ============================================
// PAYCART ELECTRONICS — app.js
// Cognito authentication + API + Cart logic
// ============================================

// ── CONFIGURATION ──────────────────────────
// Your AWS Cognito credentials
const COGNITO_USER_POOL_ID = "us-east-1_bg0GauMu3";
const COGNITO_CLIENT_ID    = "52gt24l0hu788fk5h923mp4m64";
const COGNITO_REGION       = "us-east-1";

// Your API Gateway URL — swap this when Odinaka sends it
const API_URL = "https://your-api-gateway-url-here";

// Cognito endpoints built from the above
const COGNITO_URL = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;


// ── TOAST NOTIFICATIONS ────────────────────
// Shows a small popup message at bottom-right

function showToast(message, type = "success") {
  // Create toast element if it doesn't exist
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = (type === "success" ? "✅ " : "❌ ") + message;
  toast.className = `toast ${type}`;

  // Animate in
  setTimeout(() => toast.classList.add("show"), 10);

  // Animate out after 3 seconds
  setTimeout(() => toast.classList.remove("show"), 3000);
}


// ── CART ───────────────────────────────────
// Cart is stored in localStorage so it persists across pages

function getCart() {
  return JSON.parse(localStorage.getItem("paycart_cart") || "[]");
}

function saveCart(cart) {
  localStorage.setItem("paycart_cart", JSON.stringify(cart));
}

function addToCart(product) {
  const cart = getCart();
  const existing = cart.find(i => i.id === product.id);

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ ...product, quantity: 1 });
  }

  saveCart(cart);
  updateCartBadge();
  showToast(`${product.name} added to cart!`);
}

function removeFromCart(productId) {
  const cart = getCart().filter(i => i.id !== productId);
  saveCart(cart);
  renderCart();
  updateCartBadge();
}

function updateQuantity(productId, newQty) {
  if (newQty <= 0) { removeFromCart(productId); return; }
  const cart = getCart();
  const item = cart.find(i => i.id === productId);
  if (item) { item.quantity = newQty; saveCart(cart); renderCart(); updateCartBadge(); }
}

function getCartTotal() {
  return getCart().reduce((t, i) => t + (i.price * i.quantity), 0);
}

function getCartCount() {
  return getCart().reduce((t, i) => t + i.quantity, 0);
}

function updateCartBadge() {
  const badge = document.getElementById("cart-badge");
  if (!badge) return;
  const count = getCartCount();
  badge.textContent = count;
  badge.style.display = count > 0 ? "flex" : "none";
}

// Format number as Nigerian Naira
function formatPrice(amount) {
  return "₦" + Number(amount).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


// ── COGNITO AUTH ───────────────────────────
// We call the Cognito API directly using fetch
// No SDK needed — lighter and works in plain HTML

// Sign up a new user
async function cognitoSignUp(name, email, password) {
  const response = await fetch(COGNITO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.SignUp"
    },
    body: JSON.stringify({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "name",  Value: name  }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || "Sign up failed");
  }

  return response.json();
}

// Confirm sign up with the verification code Cognito emails
async function cognitoConfirmSignUp(email, code) {
  const response = await fetch(COGNITO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.ConfirmSignUp"
    },
    body: JSON.stringify({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || "Confirmation failed");
  }
}

// Sign in and get JWT tokens
async function cognitoSignIn(email, password) {
  const response = await fetch(COGNITO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth"
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password
      }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || "Sign in failed");
  }

  const data = await response.json();
  return data.AuthenticationResult;  // Contains IdToken, AccessToken, RefreshToken
}

// Store tokens and user info after login
function saveSession(tokens, email) {
  localStorage.setItem("paycart_id_token",      tokens.IdToken);
  localStorage.setItem("paycart_access_token",  tokens.AccessToken);
  localStorage.setItem("paycart_refresh_token", tokens.RefreshToken);
  localStorage.setItem("paycart_user_email",    email);

  // Decode the JWT to get the user's name (no library needed)
  try {
    const payload = JSON.parse(atob(tokens.IdToken.split(".")[1]));
    localStorage.setItem("paycart_user_name", payload.name || email);
  } catch(e) {
    localStorage.setItem("paycart_user_name", email);
  }
}

// Get the stored ID token (used to authenticate API calls)
function getIdToken() {
  return localStorage.getItem("paycart_id_token");
}

// Check if a user is currently logged in
function isLoggedIn() {
  return !!getIdToken();
}

// Clear session on logout
function logout() {
  ["paycart_id_token","paycart_access_token","paycart_refresh_token",
   "paycart_user_email","paycart_user_name"].forEach(k => localStorage.removeItem(k));
  window.location.href = "login.html";
}

// Update navbar to show user name or login link
function updateNavbar() {
  const loginLink  = document.getElementById("nav-login");
  const logoutLink = document.getElementById("nav-logout");
  const userLabel  = document.getElementById("nav-username");

  if (isLoggedIn()) {
    const name = localStorage.getItem("paycart_user_name") || "Account";
    if (loginLink)  loginLink.style.display  = "none";
    if (logoutLink) logoutLink.style.display = "block";
    if (userLabel)  userLabel.textContent    = "Hi, " + name.split(" ")[0];
  } else {
    if (loginLink)  loginLink.style.display  = "block";
    if (logoutLink) logoutLink.style.display = "none";
    if (userLabel)  userLabel.textContent    = "";
  }
}

// Make an authenticated API call (attaches JWT token in header)
async function apiCall(path, options = {}) {
  const token = getIdToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}


// ── REGISTER FORM HANDLER ──────────────────
// Called from register.html form submit

async function handleRegister(event) {
  event.preventDefault();

  const name     = document.getElementById("name").value.trim();
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const confirm  = document.getElementById("confirm-password").value;
  const errorEl  = document.getElementById("register-error");
  const btn      = document.getElementById("register-btn");

  // Hide any previous error
  errorEl.style.display = "none";

  if (password !== confirm) {
    errorEl.textContent = "Passwords do not match.";
    errorEl.style.display = "block";
    return;
  }

  btn.textContent = "Creating account...";
  btn.disabled = true;

  try {
    await cognitoSignUp(name, email, password);

    // Save email so confirm page knows who to confirm
    localStorage.setItem("paycart_pending_email", email);

    // Go to confirmation page
    window.location.href = "confirm.html";

  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
    btn.textContent = "Create Account";
    btn.disabled = false;
  }
}


// ── CONFIRM FORM HANDLER ───────────────────
// Called from confirm.html (code verification)

async function handleConfirm(event) {
  event.preventDefault();

  const email   = localStorage.getItem("paycart_pending_email");
  const code    = document.getElementById("code").value.trim();
  const errorEl = document.getElementById("confirm-error");
  const btn     = document.getElementById("confirm-btn");

  errorEl.style.display = "none";
  btn.textContent = "Verifying...";
  btn.disabled = true;

  try {
    await cognitoConfirmSignUp(email, code);
    showToast("Account confirmed! Please sign in.");
    window.location.href = "login.html";

  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
    btn.textContent = "Confirm Account";
    btn.disabled = false;
  }
}


// ── LOGIN FORM HANDLER ─────────────────────
// Called from login.html form submit

async function handleLogin(event) {
  event.preventDefault();

  const email   = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const errorEl  = document.getElementById("login-error");
  const btn      = document.getElementById("login-btn");

  errorEl.style.display = "none";
  btn.textContent = "Signing in...";
  btn.disabled = true;

  try {
    const tokens = await cognitoSignIn(email, password);
    saveSession(tokens, email);
    window.location.href = "index.html";  // Redirect to homepage after login

  } catch (err) {
    errorEl.textContent = err.message.includes("Incorrect") ? "Incorrect email or password." : err.message;
    errorEl.style.display = "block";
    btn.textContent = "Sign In";
    btn.disabled = false;
  }
}


// ── PRODUCTS ───────────────────────────────

async function loadProducts() {
  const grid = document.getElementById("product-grid");
  if (!grid) return;

  grid.innerHTML = `
    <div class="loading" style="grid-column:1/-1">
      <div class="spinner"></div>
      <p>Loading products...</p>
    </div>`;

  try {
    const products = await apiCall("/products");

    if (!products.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">📦</div>
          <h3>No products yet</h3>
          <p>Check back soon!</p>
        </div>`;
      return;
    }

    // Assign badges for visual variety
    const badges = ["new","sale","hot",null,null];

    grid.innerHTML = products.map((p, i) => {
      const badge = badges[i % badges.length];
      const badgeHtml = badge
        ? `<span class="card-badge badge-${badge}">${badge}</span>` : "";

      // Fake "original price" for sale effect (10-20% above actual price)
      const fakeOriginal = badge === "sale"
        ? formatPrice(p.price * 1.15) : "";

      return `
      <div class="product-card" onclick="viewProduct(${p.id})">
        ${badgeHtml}
        <button class="card-wishlist" onclick="event.stopPropagation(); toggleWishlist(${p.id})">🤍</button>
        <div class="card-image">
          <img
            src="${p.image_url || `https://via.placeholder.com/300x200/f0f0ff/6c63ff?text=${encodeURIComponent(p.name)}`}"
            alt="${p.name}"
            onerror="this.src='https://via.placeholder.com/300x200/f0f0ff/6c63ff?text=Product'"
          />
        </div>
        <div class="card-body">
          <div class="card-category">Electronics</div>
          <div class="card-title">${p.name}</div>
          <div class="card-rating">
            <span class="stars">★★★★★</span>
            <span class="rating-count">(${Math.floor(Math.random()*200)+10})</span>
          </div>
          <div class="card-price-row">
            <div>
              <span class="card-price">${formatPrice(p.price)}</span>
              ${fakeOriginal ? `<span class="card-price-old">${fakeOriginal}</span>` : ""}
            </div>
            <button class="card-add-btn"
              onclick="event.stopPropagation(); addToCart(${JSON.stringify(p).replace(/"/g,'&quot;')})">
              +
            </button>
          </div>
        </div>
      </div>`;
    }).join("");

  } catch (err) {
    grid.innerHTML = `
      <div class="error-box" style="grid-column:1/-1; display:block">
        Could not load products. API not connected yet.<br>
        <small style="opacity:0.7">${err.message}</small>
      </div>`;
  }
}

function viewProduct(productId) {
  sessionStorage.setItem("paycart_product_id", productId);
  window.location.href = "product.html";
}

async function loadProductDetail() {
  const productId = sessionStorage.getItem("paycart_product_id");
  if (!productId) { window.location.href = "index.html"; return; }

  try {
    const p = await apiCall(`/products/${productId}`);

    document.getElementById("product-image").src = p.image_url ||
      `https://via.placeholder.com/500x400/f0f0ff/6c63ff?text=${encodeURIComponent(p.name)}`;
    document.getElementById("product-name").textContent = p.name;
    document.getElementById("product-price").textContent = formatPrice(p.price);
    document.getElementById("product-description").textContent = p.description || "No description available.";
    document.getElementById("product-stock").textContent = p.stock_qty > 0 ? `✓ ${p.stock_qty} in stock` : "Out of stock";
    document.getElementById("product-stock").className = `stock-badge ${p.stock_qty > 0 ? "stock-in" : "stock-out"}`;
    document.getElementById("add-to-cart-btn").onclick = () => addToCart(p);

  } catch (err) {
    document.getElementById("product-detail-container").innerHTML =
      `<div class="error-box" style="display:block">Could not load product.</div>`;
  }
}

function toggleWishlist(productId) {
  showToast("Added to wishlist!");
}


// ── CART PAGE ──────────────────────────────

function renderCart() {
  const cartContainer  = document.getElementById("cart-items");
  const summaryEl      = document.getElementById("cart-summary");
  if (!cartContainer) return;

  const cart = getCart();

  if (!cart.length) {
    cartContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛒</div>
        <h3>Your cart is empty</h3>
        <p>Find something you like!</p>
        <a href="index.html" class="btn-primary" style="margin-top:20px">Shop Now</a>
      </div>`;
    if (summaryEl) summaryEl.style.display = "none";
    return;
  }

  cartContainer.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-img">
        <img src="${item.image_url ||
          `https://via.placeholder.com/80x80/f0f0ff/6c63ff?text=${encodeURIComponent(item.name)}`}"
          alt="${item.name}" />
      </div>
      <div class="cart-item-details">
        <div class="item-category">Electronics</div>
        <h4>${item.name}</h4>
        <p style="font-size:13px;color:#888;margin-bottom:10px">${formatPrice(item.price)} each</p>
        <div class="qty-controls">
          <button class="qty-btn" onclick="updateQuantity(${item.id}, ${item.quantity - 1})">−</button>
          <span class="qty-value">${item.quantity}</span>
          <button class="qty-btn" onclick="updateQuantity(${item.id}, ${item.quantity + 1})">+</button>
        </div>
      </div>
      <div class="cart-item-right">
        <div class="cart-item-price">${formatPrice(item.price * item.quantity)}</div>
        <button class="remove-btn" onclick="removeFromCart(${item.id})">✕ Remove</button>
      </div>
    </div>`).join("");

  if (summaryEl) {
    summaryEl.style.display = "block";
    const subtotal = getCartTotal();
    const shipping = subtotal > 0 ? 2500 : 0;
    document.getElementById("subtotal").textContent = formatPrice(subtotal);
    document.getElementById("shipping").textContent = formatPrice(shipping);
    document.getElementById("total").textContent    = formatPrice(subtotal + shipping);
  }
}


// ── CHECKOUT ───────────────────────────────

async function placeOrder(event) {
  event.preventDefault();

  if (!isLoggedIn()) {
    showToast("Please sign in first", "error");
    window.location.href = "login.html";
    return;
  }

  const cart = getCart();
  if (!cart.length) { showToast("Your cart is empty", "error"); return; }

  const btn = document.getElementById("place-order-btn");
  btn.textContent = "Placing Order...";
  btn.disabled = true;

  try {
    await apiCall("/orders", {
      method: "POST",
      body: JSON.stringify({
        total_amount: getCartTotal(),
        items: cart.map(i => ({
          product_id: i.id,
          quantity: i.quantity,
          unit_price: i.price
        }))
      })
    });

    localStorage.removeItem("paycart_cart");
    updateCartBadge();

    document.getElementById("checkout-form").style.display = "none";
    document.getElementById("order-success").style.display = "block";

  } catch (err) {
    showToast("Order failed. Please try again.", "error");
    btn.textContent = "Place Order";
    btn.disabled = false;
  }
}


// ── ADMIN ──────────────────────────────────

async function loadAdminProducts() {
  const tbody = document.getElementById("products-tbody");
  if (!tbody) return;

  try {
    const products = await apiCall("/products");
    document.getElementById("stat-products").textContent = products.length;

    tbody.innerHTML = products.map(p => `
      <tr>
        <td><strong>#${p.id}</strong></td>
        <td>${p.name}</td>
        <td>${formatPrice(p.price)}</td>
        <td>${p.stock_qty}</td>
        <td>
          <button class="btn-secondary" style="padding:5px 12px;font-size:12px"
            onclick="editProduct(${p.id})">Edit</button>
          <button class="btn-primary" style="padding:5px 12px;font-size:12px;background:#ff6584;margin-left:6px"
            onclick="deleteProduct(${p.id})">Delete</button>
        </td>
      </tr>`).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#888">Could not load. API not connected.</td></tr>`;
  }
}

async function loadAdminOrders() {
  const tbody = document.getElementById("orders-tbody");
  if (!tbody) return;

  try {
    const orders = await apiCall("/orders");
    document.getElementById("stat-orders").textContent = orders.length;

    const revenue = orders.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);
    document.getElementById("stat-revenue").textContent = formatPrice(revenue);

    tbody.innerHTML = orders.map(o => `
      <tr>
        <td><strong>#${o.id}</strong></td>
        <td>#${o.user_id}</td>
        <td>${formatPrice(o.total_amount)}</td>
        <td><span class="status-badge status-${o.status}">${o.status}</span></td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
      </tr>`).join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#888">Could not load. API not connected.</td></tr>`;
  }
}

async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  try {
    await apiCall(`/admin/products/${id}`, { method: "DELETE" });
    showToast("Product deleted");
    loadAdminProducts();
  } catch (e) {
    showToast("Could not delete product", "error");
  }
}

function editProduct(id) {
  showToast("Edit feature coming soon!");
}


// ── INIT ───────────────────────────────────
// Runs when any page loads

document.addEventListener("DOMContentLoaded", () => {
  updateCartBadge();
  updateNavbar();

  const page = window.location.pathname.split("/").pop() || "index.html";

  if (page === "index.html" || page === "")   loadProducts();
  if (page === "product.html")                loadProductDetail();
  if (page === "cart.html")                   renderCart();
  if (page === "admin.html") { loadAdminProducts(); loadAdminOrders(); }
});
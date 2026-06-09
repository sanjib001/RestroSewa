// menu.js 

// --- CONFIGURATION ---
const SUPABASE_URL = 'https://alcdglhmitibxzeltioi.supabase.co';
// WARNING: REPLACE THIS WITH YOUR REAL Supabase ANON KEY
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsY2RnbGhtaXRpYnh6ZWx0aW9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODc1MjgsImV4cCI6MjA4OTA2MzUyOH0.luW8aBhMU1RaelO2rqr2W51xdwD6htVgi7BIF7dR9d4';
// ---------------------

// Initialize Supabase Client
var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let menuItems = [];
let uniqueCategories = [];
let activeCategory = 'All';
let cart = []; // Array of { id, item, price_paise, qty } 
let currentTable = null;
let currentOpenOrder = null;
let orderSubscription = null;
let esewaPaymentInProgress = false;

function resetMenuSessionState() {
    menuItems = [];
    uniqueCategories = [];
    activeCategory = 'All';
    cart = [];
    currentTable = null;
    currentOpenOrder = null;
    esewaPaymentInProgress = false;

    if (orderSubscription) {
        supabase.removeChannel(orderSubscription);
        orderSubscription = null;
    }

    const tableInfoEl = document.getElementById('table-info');
    if (tableInfoEl) tableInfoEl.textContent = 'Table: --';

    const orderStatusEl = document.getElementById('order-status');
    if (orderStatusEl) orderStatusEl.textContent = 'Loading table...';

    const menuItemsEl = document.getElementById('menu-items');
    if (menuItemsEl) {
        menuItemsEl.innerHTML = '<div class="text-center py-10 text-gray-400">Loading Items...</div>';
    }

    const existingTabItemsEl = document.getElementById('existing-tab-items');
    if (existingTabItemsEl) {
        existingTabItemsEl.innerHTML = '<p class="text-sm text-gray-400">Checking for existing tab...</p>';
    }

    const newCartListEl = document.getElementById('new-cart-list');
    if (newCartListEl) {
        newCartListEl.innerHTML = '<p class="text-sm text-gray-400">Cart is empty.</p>';
    }

    const cartTotalEl = document.getElementById('cart-total');
    if (cartTotalEl) cartTotalEl.textContent = 'Rs. 0.00';

    const placeOrderBtn = document.getElementById('place-order-btn');
    if (placeOrderBtn) {
        placeOrderBtn.disabled = true;
        placeOrderBtn.textContent = 'Place New Order';
    }

    const mobileCartBadge = document.getElementById('mobile-cart-badge');
    if (mobileCartBadge) {
        mobileCartBadge.classList.add('hidden');
        mobileCartBadge.textContent = '0';
    }
}

function resetCustomerPanelsForNewOrder() {
    currentOpenOrder = null;
    cart = [];
    activeCategory = 'All';
    esewaPaymentInProgress = false;

    const orderStatusEl = document.getElementById('order-status');
    if (orderStatusEl) orderStatusEl.textContent = 'Ready to take new order.';

    const existingItemsContainer = document.getElementById('existing-tab-items');
    if (existingItemsContainer) {
        existingItemsContainer.innerHTML = '<p class="text-sm text-gray-500">No active tab found. Start a new order!</p>';
    }

    renderCategoryFilter();
    updateCartDisplay();
    renderMenu();

    if (orderSubscription) {
        supabase.removeChannel(orderSubscription);
        orderSubscription = null;
    }
}

function shouldStartFreshForTable(tableId) {
    const freshFlag = getUrlParameter('fresh');
    if (freshFlag === '1' || freshFlag === 'true') {
        return true;
    }

    try {
        const storedReset = sessionStorage.getItem('chakra_post_payment_reset');
        if (!storedReset) return false;

        const parsedReset = JSON.parse(storedReset);
        if (!parsedReset || !parsedReset.table) return false;

        return String(parsedReset.table).toUpperCase() === String(tableId || '').toUpperCase();
    } catch (error) {
        console.warn('Unable to read post-payment reset flag:', error);
        return false;
    }
}

// --- UTILITY FUNCTIONS ---
function standardizeCategoryName(category) {
    if (!category || typeof category !== 'string' || category.length === 0) {
        return '';
    }
    return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
}

function toPaise(rupees) {
    return Math.round(parseFloat(rupees || 0) * 100);
}

function formatPaiseToRupees(paise) {
    const amount = Math.round(paise);
    return (amount / 100).toFixed(2);
}

function getOrderPaymentAmountPaise(order) {
    return toPaise(order && (order.due_amount || order.total_amount || 0));
}

function isOrderPaid(order) {
    if (!order) return false;
    return order.status === 'paid';
}

function getSupabaseProjectRef() {
    try {
        return new URL(SUPABASE_URL).hostname.split('.')[0];
    } catch (error) {
        return '';
    }
}

function buildEsewaFunctionUrl() {
    const projectRef = getSupabaseProjectRef();
    return projectRef ? `https://${projectRef}.supabase.co/functions/v1/esewa-initiate` : '';
}

function setEsewaButtonLoading(isLoading) {
    esewaPaymentInProgress = isLoading;

    const payButton = document.getElementById('esewa-pay-btn');
    if (!payButton) return;

    payButton.disabled = isLoading;
    payButton.innerHTML = isLoading
        ? '<span class="inline-flex items-center gap-2"><span class="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>Redirecting to eSewa...</span>'
        : 'Pay with eSewa';
}

function redirectToEsewa(url, formData) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.style.display = 'none';

    Object.entries(formData || {}).forEach(([key, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
}

async function payWithEsewa(order) {
    if (!order || esewaPaymentInProgress) return;

    const amountPaise = getOrderPaymentAmountPaise(order);
    const amountRupees = Number(formatPaiseToRupees(amountPaise));
    if (amountPaise <= 0) {
        if (typeof window.showToast === 'function') {
            window.showToast('No payment is due for this order.', 'info');
        } else {
            alert('❌ No payment is due for this order.');
        }
        return;
    }

    setEsewaButtonLoading(true);

    try {
        if (typeof CryptoJS === 'undefined') {
            throw new Error('CryptoJS library is not loaded. Cannot generate eSewa signature.');
        }

        // eSewa Test Environment Details
        const esewaUrl =
            "https://rc-epay.esewa.com.np/api/epay/main/v2/form";

        const secretKey = "8gBm/:&EnhH.1/q";

const transactionUuid = `${order.id}-${Date.now()}`;
        const productCode = "EPAYTEST";

        const amountStr = String(parseInt(amountRupees));

        const successUrl =
            `${window.location.origin}/payment/success.html?order_id=${order.id}&table=${currentTable || ''}`;

        const failureUrl =
            `${window.location.origin}/payment/failure.html?order_id=${order.id}&table=${currentTable || ''}`;

        const signedFieldNames =
            "total_amount,transaction_uuid,product_code";

        const signatureString =
            `total_amount=${amountStr},transaction_uuid=${transactionUuid},product_code=${productCode}`;

        const hash = CryptoJS.HmacSHA256(signatureString, secretKey);

        const signature =
            CryptoJS.enc.Base64.stringify(hash);

        const formData = {
            amount: amountStr,
            tax_amount: "0",
            total_amount: amountStr,
            transaction_uuid: transactionUuid,
            product_code: productCode,
            product_service_charge: "0",
            product_delivery_charge: "0",
            success_url: successUrl,
            failure_url: failureUrl,
            signed_field_names: signedFieldNames,
            signature: signature
        };

        redirectToEsewa(esewaUrl, formData);
    } catch (error) {
        console.error('eSewa initiation error:', error);
        const friendlyMessage = error.message ? `Unable to start eSewa payment: ${error.message}` : 'Unable to start eSewa payment. Please try again.';

        if (typeof window.showToast === 'function') {
            window.showToast(friendlyMessage, 'error');
        } else {
            alert(`❌ ${friendlyMessage}`);
        }
        setEsewaButtonLoading(false);
    }
}


// --- 1. INITIALIZATION AND SETUP ---

function getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

document.addEventListener('DOMContentLoaded', async () => {
    resetMenuSessionState();

    const tableId = getUrlParameter('table');

    if (!tableId || !/^[A-Z0-9]+$/i.test(tableId)) { // Allow alphanumeric
        document.getElementById('table-info').textContent = 'Error';
        document.getElementById('order-status').textContent = 'Invalid table ID in URL (must be alphanumeric, e.g., A1 or R3).';
        return;
    }

    currentTable = tableId.toUpperCase();
    const tableInfoEl = document.getElementById('table-info');
    if (tableInfoEl) tableInfoEl.textContent = `Table: ${currentTable}`;

    const startFresh = shouldStartFreshForTable(currentTable);

    await fetchMenu();
    renderCategoryFilter();

    if (startFresh) {
        resetCustomerPanelsForNewOrder();

        try {
            sessionStorage.removeItem('chakra_post_payment_reset');
        } catch (error) {
            console.warn('Unable to clear post-payment reset flag:', error);
        }

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('fresh');
        window.history.replaceState({}, '', nextUrl.toString());
    } else {
        await checkForOpenTab();
    }

    const placeOrderBtn = document.getElementById('place-order-btn');
    if (placeOrderBtn) placeOrderBtn.addEventListener('click', sendOrder);

    updateCartDisplay();
});

window.addEventListener('pageshow', event => {
    if (event.persisted) {
        resetMenuSessionState();
        window.location.reload();
    }
});


// --- 2. DATA FETCHING & OPEN TAB CHECK (Customer Visibility) ---

async function fetchMenu() {
    const { data, error } = await supabase
        .from('menus')
        .select('*')
        .eq('is_available', true)
        .order('category, item_name', { ascending: true });

    if (error) {
        console.error('Error fetching menu:', error);
        document.getElementById('menu-items').innerHTML = `<h2 class="text-xl font-bold text-red-500">❌ Failed to load menu.</h2>`;
        return;
    }

    menuItems = data;
    const categories = new Set(data.map(item => standardizeCategoryName(item.category)));
    uniqueCategories = ['All', ...Array.from(categories)].sort();
    renderMenu();
}

async function checkForOpenTab() {
    const orderStatusEl = document.getElementById('order-status');
    orderStatusEl.textContent = 'Checking for existing orders...';

    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('table_number', currentTable)
        .not('status', 'in', '("paid", "cancelled")')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('Error checking open tab:', error);
        orderStatusEl.textContent = 'Error checking order status.';
        return;
    }

    if (data) {
        currentOpenOrder = data;
        renderOpenTabDisplay(data);
        orderStatusEl.textContent = `Open Tab: Order ID ${data.id.substring(0, 8)}... (Status: ${data.status.toUpperCase()})`;
        subscribeToOrderChanges(data.id);
        return;
    }

    currentOpenOrder = null;
    orderStatusEl.textContent = 'Ready to take new order.';
    renderOpenTabDisplay(null);

    if (orderSubscription) {
        supabase.removeChannel(orderSubscription);
        orderSubscription = null;
    }
}

function subscribeToOrderChanges(orderId) {
    if (orderSubscription) {
        supabase.removeChannel(orderSubscription);
    }

    orderSubscription = supabase
        .channel(`order_updates_${orderId}`)
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
            payload => {
                const newOrder = payload.new;
                currentOpenOrder = newOrder;
                renderOpenTabDisplay(newOrder);

                // Only update the status text if the tab hasn't been closed
                if (newOrder.status !== 'paid' && newOrder.status !== 'cancelled') {
                    document.getElementById('order-status').textContent =
                        `Open Tab: Order ID ${newOrder.id.substring(0, 8)}... (Status: ${newOrder.status.toUpperCase()})`;
                }
            })
        .on('postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
            payload => {
                console.log("Order deleted, triggering session reset.");
                // Passing a terminal state object to reset the display
                renderOpenTabDisplay({ status: 'cancelled', order_items: [], total_amount: 0 });
            })
        .subscribe();
}

/**
 * Clears the customer_message field in the database when the customer acknowledges it.
 */
async function clearCustomerMessage(orderId) {
    const { error } = await supabase
        .from('orders')
        .update({ customer_message: null })
        .eq('id', orderId);

    if (error) {
        console.error('Error clearing customer message:', error);
        alert('Could not dismiss message. Please refresh.');
    } else {
        // Force a re-render of the open tab to hide the message immediately
        await checkForOpenTab();
    }
}


/**
 * Renders the existing items (the "Open Tab") for the customer, distinguishing served from pending.
 */
function renderOpenTabDisplay(order) {
    const existingItemsContainer = document.getElementById('existing-tab-items');
    existingItemsContainer.innerHTML = '';

    // Handle terminal statuses (Paid/Cancelled/Deleted)
    if (order && (order.status === 'paid' || order.status === 'cancelled')) {

        // Reset every customer-facing panel so the same table can start fresh.
        resetCustomerPanelsForNewOrder();

        // Notify the customer that the session was reset
        if (typeof window.showToast === 'function') {
            const message = order.status === 'paid' ? 'Payment received. Your tab has been reset.' : 'Order cancelled. Your tab has been reset.';
            window.showToast(message, 'success');
        }

        return;
    }

    // RENDER OPEN TAB
    if (order && order.order_items && order.order_items.length > 0) {

        // Check for an unacknowledged message (Modification Alert)
        if (order.customer_message) {
            const messageEl = document.createElement('div');
            messageEl.className = 'bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-3 mb-3 font-bold';
            messageEl.innerHTML = `
                <p class="font-bold">⚠️ IMPORTANT MESSAGE FROM THE KITCHEN:</p>
                <p class="text-sm mt-1">${order.customer_message}</p>
                <button onclick="clearCustomerMessage('${order.id}')" 
                        class="mt-2 text-xs py-1 px-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600">
                    Acknowledge & Dismiss
                </button>
             `;
            existingItemsContainer.appendChild(messageEl);
        }

        const servedCount = order.served_item_count || 0;
        const existingItems = order.order_items;

        const totalOrderTotalPaise = toPaise(order.total_amount);

        const summaryEl = document.createElement('div');
        summaryEl.className = 'flex justify-between items-center text-lg font-bold pt-1 pb-2 border-b';
        summaryEl.innerHTML = `
            <span>Current Bill Total:</span>
            <span class="text-red-500">Rs. ${formatPaiseToRupees(totalOrderTotalPaise)}</span>
        `;
        existingItemsContainer.appendChild(summaryEl);


        const listHeader = document.createElement('h4');
        listHeader.className = 'text-base font-semibold text-gray-600 mt-2 mb-1';
        listHeader.textContent = 'Item Status:';
        existingItemsContainer.appendChild(listHeader);

        // 1. Render Served Items (Strikethrough)
        existingItems.slice(0, servedCount).forEach(item => {
            const itemPriceFixed = parseFloat(item.price).toFixed(2);
            const itemEl = document.createElement('div');
            itemEl.className = 'flex justify-between items-center text-sm py-1 served-item';
            itemEl.innerHTML = `
                <span>${item.item}</span>
                <span class="font-medium">${item.qty} x Rs. ${itemPriceFixed}</span>
            `;
            existingItemsContainer.appendChild(itemEl);
        });

        // 2. Render Unsent/Pending Items (Bold/Highlighted)
        existingItems.slice(servedCount).forEach(item => {
            const itemPriceFixed = parseFloat(item.price).toFixed(2);
            const itemEl = document.createElement('div');
            itemEl.className = 'flex justify-between items-center text-sm py-1 pending-item';
            itemEl.innerHTML = `
                <span>${item.item} (Waiting)</span>
                <span class="font-medium">${item.qty} x Rs. ${itemPriceFixed}</span>
            `;
            existingItemsContainer.appendChild(itemEl);
        });

        const amountDuePaise = getOrderPaymentAmountPaise(order);
        if (!isOrderPaid(order) && amountDuePaise > 0) {
            // Keep the payment CTA inside the live tab so the customer can pay without leaving the order screen.
            const paymentCard = document.createElement('div');
            paymentCard.className = 'mt-4 p-4 rounded-xl border border-green-200 bg-green-50';
            paymentCard.innerHTML = `
                <div class="flex items-center justify-between gap-3 mb-3">
                    <div>
                        <p class="text-sm font-semibold text-green-700">Ready to pay?</p>
                        <p class="text-xs text-green-600">Securely pay Rs. ${formatPaiseToRupees(amountDuePaise)} with eSewa.</p>
                    </div>
                    <button id="esewa-pay-btn" type="button" onclick="payWithEsewa(currentOpenOrder)"
                        class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white font-semibold shadow-sm hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed">
                        Pay with eSewa
                    </button>
                </div>
                <p class="text-xs text-green-600">You will be redirected to eSewa to complete the payment.</p>
            `;
            existingItemsContainer.appendChild(paymentCard);

            if (esewaPaymentInProgress) {
                setEsewaButtonLoading(true);
            }
        }

    } else {
        // If no open order or no items
        existingItemsContainer.innerHTML = '<p class="text-sm text-gray-500">No active tab found. Start a new order!</p>';
    }

    updateCartDisplay();
}

// --- 3. MENU RENDERING (Standard) ---
function renderCategoryFilter() {
    const filterContainer = document.getElementById('category-filter');
    if (!filterContainer) return;

    filterContainer.innerHTML = '';

    const selectEl = document.createElement('select');
    selectEl.id = 'category-select';
    selectEl.className = 'w-full py-2 px-3 text-base bg-white border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 transition duration-150';

    selectEl.onchange = (event) => {
        activeCategory = event.target.value;
        renderMenu();
    };

    uniqueCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category === 'All' ? 'All Categories' : category;
        if (category === activeCategory) {
            option.selected = true;
        }
        selectEl.appendChild(option);
    });

    filterContainer.appendChild(selectEl);
}

function renderMenu() {
    const menuItemsEl = document.getElementById('menu-items');
    if (!menuItemsEl) return;
    menuItemsEl.innerHTML = '';

    let itemsToRender = menuItems;

    if (activeCategory !== 'All') {
        itemsToRender = menuItems.filter(item =>
            standardizeCategoryName(item.category) === activeCategory
        );
    }

    itemsToRender.forEach(item => {
        renderMenuItemCard(item, menuItemsEl);
    });

    if (itemsToRender.length === 0) {
        menuItemsEl.innerHTML = `<p class="text-center text-gray-500 py-10">No items available in the ${activeCategory} category.</p>`;
    }
}

function renderMenuItemCard(item, container) {
    const cartItem = cart.find(cartEntry => cartEntry.id === item.id);
    const itemQty = cartItem ? cartItem.qty : 0;
    const itemDiv = document.createElement('div');
    itemDiv.className = `bg-white p-4 rounded-xl flex justify-between items-center shadow-sm hover:shadow-md transition duration-150 ${itemQty > 0 ? 'menu-item-selected' : ''}`;

    const safeItemName = item.item_name.replace(/'/g, "\\'");

    itemDiv.innerHTML = `
        <div class="pr-3">
            <div class="flex items-center gap-2 flex-wrap mb-1">
                <h4 class="font-semibold text-gray-800">${item.item_name}</h4>
                ${item.is_special ? '<span class="menu-special-badge">Chef\'s pick</span>' : ''}
            </div>
            <p class="text-sm text-gray-500">Rs. ${item.price.toFixed(2)}</p>
            ${itemQty > 0 ? `<p class="mt-2 text-xs font-semibold text-amber-700">Added ${itemQty} ${itemQty === 1 ? 'time' : 'times'}</p>` : ''}
        </div>
        <div class="menu-item-actions">
            ${itemQty > 0 ? `
                <button onclick="decrementMenuItem('${item.id}')" class="menu-step-btn menu-step-btn-minus" aria-label="Decrease ${item.item_name}">−</button>
                <span class="menu-quantity-pill">${itemQty}</span>
                <button onclick="addToCart('${item.id}', '${safeItemName}', ${item.price})" class="menu-step-btn menu-step-btn-plus" aria-label="Increase ${item.item_name}">+</button>
            ` : `
                <button onclick="addToCart('${item.id}', '${safeItemName}', ${item.price})"
                    class="menu-add-btn">
                    Add
                </button>
            `}
        </div>
    `;
    container.appendChild(itemDiv);
}


// --- 4. CART MANAGEMENT (Standard) ---

function addToCart(itemId, itemName, priceRupees) {
    const pricePaise = toPaise(priceRupees);
    const existingItem = cart.find(item => item.id === itemId);

    if (existingItem) {
        existingItem.qty += 1;
    } else {
        cart.push({ id: itemId, item: itemName, price_paise: pricePaise, qty: 1 });
    }

    const placeOrderBtn = document.getElementById('place-order-btn');
    if (placeOrderBtn) {
        placeOrderBtn.disabled = false;
    }
    updateCartDisplay();
}

function decrementMenuItem(itemId) {
    const existingItemIndex = cart.findIndex(item => item.id === itemId);

    if (existingItemIndex === -1) {
        return;
    }

    cart[existingItemIndex].qty -= 1;

    if (cart[existingItemIndex].qty <= 0) {
        cart.splice(existingItemIndex, 1);
    }

    updateCartDisplay();
}

function updateCartQuantity(index, delta) {
    if (cart[index]) {
        cart[index].qty += delta;

        if (cart[index].qty <= 0) {
            cart.splice(index, 1);
        }
    }
    updateCartDisplay();
}

function updateCartDisplay() {
    const newCartList = document.getElementById('new-cart-list');
    const cartTotalElement = document.getElementById('cart-total');
    const placeOrderBtn = document.getElementById('place-order-btn');

    if (!newCartList) return;

    let totalPaise = 0;
    newCartList.innerHTML = '';

    if (cart.length === 0) {
        newCartList.innerHTML = '<p class="text-sm text-gray-400">Cart is empty.</p>';
        cartTotalElement.textContent = 'Rs. 0.00';
        if (placeOrderBtn) placeOrderBtn.disabled = true;

    } else {
        cart.forEach((item, index) => {
            const itemTotalPaise = item.price_paise * item.qty;
            totalPaise += itemTotalPaise;

            const listItem = document.createElement('li');
            listItem.className = 'flex justify-between items-center text-sm py-2 border-b border-gray-100 group';

            listItem.innerHTML = `
                <div class="flex-grow">
                    <span class="text-gray-800 font-medium">${item.item}</span>
                    <span class="text-gray-500 text-xs ml-2">${item.qty} x Rs. ${formatPaiseToRupees(item.price_paise)}</span>
                </div>
                <span class="font-bold text-amber-700">Rs. ${formatPaiseToRupees(itemTotalPaise)}</span>
            `;
            newCartList.appendChild(listItem);
        });

        cartTotalElement.textContent = `Rs. ${formatPaiseToRupees(totalPaise)}`;
        if (placeOrderBtn) placeOrderBtn.disabled = false;
    }

    if (placeOrderBtn) {
        placeOrderBtn.textContent = currentOpenOrder ? 'Add to Open Tab' : 'Place New Order';
    }

    renderMenu();
}


// --- 5. ORDER SUBMISSION (Status Reset Fix) ---

async function sendOrder() {
    if (cart.length === 0 || !currentTable) {
        alert('Your cart is empty or the table number is missing.');
        return;
    }

    let newItemsPaiseTotal = 0;
    const itemsPayload = cart.map(item => {
        newItemsPaiseTotal += item.price_paise * item.qty;

        return {
            item: item.item,
            qty: item.qty,
            price: parseFloat(formatPaiseToRupees(item.price_paise)),
            item_id: item.id
        };
    });

    const placeOrderBtn = document.getElementById('place-order-btn');
    placeOrderBtn.disabled = true;
    placeOrderBtn.textContent = currentOpenOrder ? 'Adding to Tab...' : 'Placing Order...';

    let result;

    if (currentOpenOrder) {
        // Adding to an existing open order
        const newOrderItems = [...currentOpenOrder.order_items, ...itemsPayload];

        const existingTotalPaise = toPaise(currentOpenOrder.total_amount);
        const finalTotalPaise = existingTotalPaise + newItemsPaiseTotal;
        const finalTotalRupees = formatPaiseToRupees(finalTotalPaise);

        const amountPaidPaise = toPaise(currentOpenOrder.cash_amount) + toPaise(currentOpenOrder.online_amount);
        const newDueAmountPaise = Math.max(0, finalTotalPaise - amountPaidPaise);

        const updates = {
            order_items: newOrderItems,
            total_amount: finalTotalRupees,
            due_amount: formatPaiseToRupees(newDueAmountPaise),
            // CRITICAL FIX: Reset status to 'preparing' to notify the kitchen
            status: 'preparing',
        };

        result = await supabase
            .from('orders')
            .update(updates)
            .eq('id', currentOpenOrder.id);

    } else {
        // Placing a brand new order
        const finalTotalRupees = formatPaiseToRupees(newItemsPaiseTotal);

        result = await supabase
            .from('orders')
            .insert([
                {
                    table_number: currentTable,
                    order_items: itemsPayload,
                    total_amount: finalTotalRupees,
                    due_amount: finalTotalRupees,
                    status: 'pending',
                    served_item_count: 0
                }
            ]);
    }

    placeOrderBtn.disabled = false;
    placeOrderBtn.textContent = currentOpenOrder ? 'Add to Open Tab' : 'Place New Order';

    if (result.error) {
        console.error('Error sending order:', result.error);
        const errorMessage = result.error.message || 'Unknown error';
        if (/row-level security|RLS|policy/i.test(errorMessage)) {
            if (typeof window.showToast === 'function') {
                window.showToast('Order submission is blocked by Supabase RLS. Please enable an INSERT policy for public.orders.', 'error');
            }
            alert('❌ Order submission is blocked by Supabase RLS. Enable an INSERT policy for public.orders or route order creation through a backend function.');
        } else {
            alert('❌ Failed to send order: ' + errorMessage);
        }
    } else {
        alert(`✅ Order sent successfully!`);
        cart = [];
        await checkForOpenTab();
        updateCartDisplay();
    }
}
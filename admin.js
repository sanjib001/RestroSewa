// admin.js

// --- CONFIGURATION ---
const SUPABASE_URL = 'https://alcdglhmitibxzeltioi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsY2RnbGhtaXRpYnh6ZWx0aW9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODc1MjgsImV4cCI6MjA4OTA2MzUyOH0.luW8aBhMU1RaelO2rqr2W51xdwD6htVgi7BIF7dR9d4';
// ---------------------

var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let ordersData = []; // Cache for filtering and summary
let menuCache = []; // Cache menu data for quick modal population
let orderChannel = null;
let isSubscribed = false;      // Track whether the channel is actively subscribed
let wasDisconnected = false;   // Track if a disconnect occurred so we know when to sync on reconnect
let reconnectTimeout = null;   // Timer for scheduled re-subscription attempts

function setOrdersState(nextOrders) {
    ordersData = nextOrders;
    renderOrders();
    updateDailySummary();
}

function sortOrdersForDisplay(nextOrders) {
    return nextOrders.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();

        if (dateA !== dateB) {
            return dateB - dateA;
        }

        const priorityA = getStatusPriority(a.status);
        const priorityB = getStatusPriority(b.status);

        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }

        const updatedA = new Date(a.updated_at).getTime();
        const updatedB = new Date(b.updated_at).getTime();
        return updatedB - updatedA;
    });
}

function cleanupRealtimeSubscriptions() {
    if (orderChannel) {
        supabase.removeChannel(orderChannel);
        orderChannel = null;
    }
    isSubscribed = false;
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
}

window.addEventListener('beforeunload', cleanupRealtimeSubscriptions);
window.addEventListener('pagehide', cleanupRealtimeSubscriptions);

// Browser online/offline connection status event listeners
window.addEventListener('online', () => {
    console.log('Browser online. Forcing realtime reconnection and syncing orders...');
    wasDisconnected = true;
    setupRealtimeSubscription();
});

window.addEventListener('offline', () => {
    console.log('Browser offline.');
    setLiveBadge(false);
    isSubscribed = false;
    wasDisconnected = true;
});

function setupRealtimeSubscription() {
    cleanupRealtimeSubscriptions();

    orderChannel = supabase.channel('public:orders_channel');

    orderChannel
        // INSERT events are the source of truth for new customer orders.
        // We update local state immediately so the admin list changes without refresh.
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, payload => {
            triggerNewOrderNotification(payload.new, '🔔 NEW ORDER');
            if (orderMatchesSelectedDate(payload.new)) {
                upsertOrderState(payload.new, true); // isNew=true → triggers row flash
            }
        })
        // UPDATE and DELETE events keep the visible list synchronized after the initial insert.
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, payload => {
            const newOrder = payload.new;
            // Robust check against local cache to detect item additions accurately
            const oldOrder = ordersData.find(o => o.id === newOrder.id);

            const newStatus = newOrder.status;
            const oldStatus = oldOrder ? oldOrder.status : null;
            const oldItemsLength = oldOrder ? (oldOrder.order_items ? oldOrder.order_items.length : 0) : 0;
            const newItemsLength = newOrder.order_items ? newOrder.order_items.length : 0;

            if (newStatus === 'paid' && oldStatus !== 'paid' && oldStatus !== 'cancelled') {
                triggerPaymentReceivedNotification(newOrder);
            }

            // Trigger alert if the order is active (not paid/cancelled) AND new items were added
            if (newStatus !== 'paid' && newStatus !== 'cancelled' && newItemsLength > oldItemsLength) {
                // Ensure we only trigger if the status has not just been served (which also updates length)
                if (newOrder.status !== 'served' || oldOrder.status === 'pending' || oldOrder.status === 'preparing') {
                    triggerNewOrderNotification(newOrder, '➕ ITEMS ADDED');
                }
            }

            if (orderMatchesSelectedDate(newOrder)) {
                upsertOrderState(newOrder);
            } else {
                removeOrderFromState(newOrder.id);
            }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, payload => {
            removeOrderFromState(payload.old.id);
        })
        .subscribe(status => {
            console.log(`Realtime subscription status update: ${status}`);
            if (status === 'SUBSCRIBED') {
                setLiveBadge(true);
                isSubscribed = true;
                if (wasDisconnected) {
                    console.log('Reconnected to Realtime database. Syncing latest orders...');
                    fetchOrders();
                    wasDisconnected = false;
                }
            } else {
                setLiveBadge(false);
                isSubscribed = false;
                wasDisconnected = true;
                if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    scheduleReconnection();
                }
            }
        });
}

function scheduleReconnection() {
    if (reconnectTimeout) return; // Reconnection attempt already scheduled
    console.log('Scheduling realtime reconnection retry in 5 seconds...');
    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        if (!isSubscribed) {
            setupRealtimeSubscription();
        }
    }, 5000);
}

function orderMatchesSelectedDate(order) {
    const dateFilter = document.getElementById('date-filter');
    if (!dateFilter || !dateFilter.value) {
        return true;
    }

    const selectedDate = dateFilter.value;
    const localStart = new Date(selectedDate);
    localStart.setHours(0, 0, 0, 0);
    const nextDay = new Date(localStart);
    nextDay.setDate(nextDay.getDate() + 1);

    const createdAt = new Date(order.created_at).getTime();
    return createdAt >= localStart.getTime() && createdAt < nextDay.getTime();
}

// Tracks which order IDs are newly inserted so renderOrders() can flash them
let _newlyInsertedOrderIds = new Set();

function upsertOrderState(nextOrder, isNew = false) {
    const nextOrders = [...ordersData];
    const existingIndex = nextOrders.findIndex(order => order.id === nextOrder.id);

    if (existingIndex === -1) {
        nextOrders.unshift(nextOrder);
        if (isNew) _newlyInsertedOrderIds.add(nextOrder.id);
    } else {
        nextOrders[existingIndex] = { ...nextOrders[existingIndex], ...nextOrder };
    }

    setOrdersState(sortOrdersForDisplay(nextOrders));
}

function updateOrderInState(orderId, updater) {
    const nextOrders = ordersData.map(order => {
        if (order.id !== orderId) {
            return order;
        }

        const updatedOrder = typeof updater === 'function' ? updater(order) : updater;
        return { ...order, ...updatedOrder };
    });

    setOrdersState(nextOrders);
}

function removeOrderFromState(orderId) {
    setOrdersState(ordersData.filter(order => order.id !== orderId));
}

function setMenuState(nextMenu) {
    menuCache = nextMenu;
    renderMenuManagement(menuCache);
}

function upsertMenuItemState(nextItem) {
    const existingIndex = menuCache.findIndex(item => item.id === nextItem.id);
    const nextMenu = [...menuCache];

    if (existingIndex === -1) {
        nextMenu.unshift(nextItem);
    } else {
        nextMenu[existingIndex] = { ...nextMenu[existingIndex], ...nextItem };
    }

    setMenuState(nextMenu);
}

function removeMenuItemState(itemId) {
    setMenuState(menuCache.filter(item => item.id !== itemId));
}

// --- UTILITY FUNCTIONS (For Safe Integer Math) ---

/**
 * Ensures category names are consistently capitalized (Title Case) 
 */
function standardizeCategoryName(category) {
    if (!category || typeof category !== 'string' || category.length === 0) {
        return '';
    }
    return category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
}

/**
 * Assigns a numeric priority based on the order status for client-side sorting.
 */
function getStatusPriority(status) {
    switch (status) {
        case 'pending':
        case 'preparing':
            return 1;
        case 'served':
        case 'partially_paid':
            return 2;
        case 'cancelled':
            return 4;
        default: // 'paid', etc. 
            return 3;
    }
}

/**
 * Converts integer Paise back to a formatted Rupee string for display.
 */
function formatPaiseToRupees(paise) {
    const amount = Math.round(paise);
    return (amount / 100).toFixed(2);
}

/**
 * Converts float/string Rupees to integer Paise.
 */
function toPaise(rupees) {
    return Math.round(parseFloat(rupees || 0) * 100);
}


// --- 1. AUTHENTICATION HANDLER (admin.html) ---

const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const messageEl = document.getElementById('login-message');
        messageEl.textContent = 'Logging in...';

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            console.error('Auth Error:', error);
            messageEl.textContent = `Login Failed: ${error.message}`;
            return;
        }

        if (data.session) {
            console.log('Login Successful, fetching profile for ID:', data.user.id);
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', data.user.id)
                .single();

            if (profileError) {
                console.error('Profile Fetch Error:', profileError);
                await supabase.auth.signOut();
                messageEl.textContent = `Access Denied: Profile verify failed (${profileError.message})`;
                return;
            }

            if (!profile || profile.role !== 'admin') {
                console.warn('Unauthorized Access:', data.user.email, profile);
                await supabase.auth.signOut();
                messageEl.textContent = 'Access Denied: Your account does not have the admin role.';
                return;
            }

            console.log('Profile verified as admin. Redirecting...');
            window.location.href = 'dashboard.html';
        }
    });
}

// --- 2. DASHBOARD INITIALIZATION & REALTIME (dashboard.html) ---

async function initDashboard() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'admin.html';
        return;
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            cleanupRealtimeSubscriptions();
            await supabase.auth.signOut();
            window.location.href = 'admin.html';
        });
    }

    const dateFilter = document.getElementById('date-filter');
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayLocal = `${year}-${month}-${day}`;

    if (dateFilter) {
        dateFilter.value = todayLocal;
        dateFilter.addEventListener('change', fetchOrders);
    }

    await fetchOrders();
    await fetchMenuForAdmin();

    setupRealtimeSubscription();

    // Safety check heartbeat: every 30 seconds, if offline/disconnected but navigator.onLine is true, attempt to re-subscribe
    setInterval(() => {
        if (!isSubscribed && navigator.onLine) {
            console.log('Heartbeat check: subscription inactive but browser online. Re-subscribing...');
            setupRealtimeSubscription();
        }
    }, 30000);

    const statusFilter = document.getElementById('status-filter');
    const tableFilter = document.getElementById('table-filter');
    const exportBtn = document.getElementById('export-btn');
    const inputCashAmount = document.getElementById('input-cash-amount');

    if (statusFilter) statusFilter.addEventListener('change', renderOrders);
    // ✅ FIX: Listens for input changes on the table filter (allowing alphanumeric input)
    if (tableFilter) tableFilter.addEventListener('input', renderOrders);

    if (exportBtn) exportBtn.addEventListener('click', exportOrders);

    if (inputCashAmount) inputCashAmount.addEventListener('input', calculateRemainingOnline);

    const newItemForm = document.getElementById('new-item-form');
    if (newItemForm) {
        newItemForm.addEventListener('submit', handleNewItemCreation);
    }
}

// --- 3. ORDER FETCHING, RENDERING & MANAGEMENT ---

async function fetchOrders() {
    const dateFilter = document.getElementById('date-filter');

    let query = supabase.from('orders').select('*');

    if (dateFilter && dateFilter.value) {
        const selectedDate = dateFilter.value;
        let localStart = new Date(selectedDate);
        localStart.setHours(0, 0, 0, 0);
        const nextDay = new Date(localStart);
        nextDay.setDate(nextDay.getDate() + 1);
        const startISO = localStart.toISOString();
        const endISO = nextDay.toISOString();

        query = query
            .gte('created_at', startISO)
            .lt('created_at', endISO);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching orders:', error);
        return;
    }

    setOrdersState(sortOrdersForDisplay(data));
}

/**
 * Renders the orders list, including visual item separation logic.
 */
function renderOrders() {
    const statusFilter = document.getElementById('status-filter').value;
    const tableFilter = document.getElementById('table-filter').value; // Get the text input value
    const ordersList = document.getElementById('orders-list');
    let pendingCount = 0;

    ordersList.innerHTML = '';

    const filteredOrders = ordersData.filter(order => {
        const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
        // ✅ FIX: This line handles alphanumeric filtering using includes()
        const matchesTable = !tableFilter || order.table_number.toLowerCase().includes(tableFilter.toLowerCase());
        return matchesStatus && matchesTable;
    });

    filteredOrders.forEach(order => {
        if (order.status === 'pending' || order.status === 'preparing') {
            pendingCount++;
        }

        let rowStatusClass = '';

        if (order.status === 'pending' || order.status === 'preparing') {
            rowStatusClass = 'order-status-pending';
        } else if (order.status === 'served' || order.status === 'partially_paid') {
            rowStatusClass = 'order-status-served';
        } else if (order.status === 'cancelled') {
            rowStatusClass = 'order-status-cancelled';
        } else {
            rowStatusClass = 'order-status-paid';
        }

        const row = ordersList.insertRow();
        row.className = rowStatusClass;

        row.innerHTML = `
            <td>${order.table_number}</td>
            <td>${new Date(order.created_at).toLocaleTimeString()}</td>
            <td>${formatOrderItems(order.order_items, order.served_item_count, order.status)}</td>
            <td>Rs. ${formatPaiseToRupees(toPaise(order.total_amount))}</td>
            <td>${getOrderStatusLabel(order)}</td>
            <td>${renderActionButton(order)}</td> 
        `;

        // Flash newly inserted rows with amber highlight
        if (_newlyInsertedOrderIds.has(order.id)) {
            row.classList.add('order-row-new');
            _newlyInsertedOrderIds.delete(order.id);
        }
    });

    const pendingCountElement = document.getElementById('pending-count');
    if (pendingCountElement) {
        pendingCountElement.textContent = `(${pendingCount} Open Orders)`;
    }
}

function getOrderStatusLabel(order) {
    if (!order) return '';

    const baseStatus = (order.status || '').toUpperCase().replace('_', ' ');
    const cashPaid = toPaise(order.cash_amount || 0);
    const onlinePaid = toPaise(order.online_amount || 0);

    if (order.status === 'paid' && onlinePaid > 0 && cashPaid === 0) {
        return 'PAID ';
    }

    return baseStatus;
}

/**
 * Formats the order items for display, adding visual separation for newly added items.
 */
function formatOrderItems(items, servedCount, currentStatus) {
    if (!items || items.length === 0) return '';

    servedCount = parseInt(servedCount) || 0;

    const formattedItems = items.map(item => `${item.item} x${item.qty}`);

    let output = '';

    // --- LOGIC FOR ALREADY RECEIVED/PREVIOUSLY SERVED ITEMS ---
    if (servedCount > 0) {
        const servedItems = formattedItems.slice(0, servedCount).join('<br>');

        output += `<span style="opacity: 0.6; text-decoration: line-through;">${servedItems}</span>`;
    }

    // --- LOGIC FOR NEWLY ADDED ITEMS (The portion the kitchen hasn't seen yet) ---
    if (items.length > servedCount) {
        // Only show the aggressive "NEW ITEMS ADDED" border if the order is active
        if (currentStatus !== 'paid' && currentStatus !== 'cancelled') {
            // This border visually cues the admin that new action is needed.
            output += `<hr style="border-top: 2px solid #8b0000; margin: 4px 0;"/>
                        <span style="font-weight: bold; color: #8b0000;">*** NEW ITEMS ADDED ***</span>
                        <hr style="border-top: 2px solid #8b0000; margin: 4px 0;"/>`;
        }

        const newItems = formattedItems.slice(servedCount).join('<br>');
        output += `<span style="font-weight: bold; color: #8b0000;">${newItems}</span>`;
    }
    // Case: Initial order (servedCount = 0, items.length > 0)
    else if (servedCount === 0 && items.length > 0) {
        output += formattedItems.join('<br>');
    }

    return output;
}


function renderActionButton(order) {
    const orderId = order.id;
    const currentStatus = order.status;

    const totalAmountPaise = toPaise(order.total_amount);
    const discountAmountPaise = toPaise(order.discount_amount);
    // Use Math.round to ensure clean integer math for final calculation
    const finalAmountPaise = Math.round(totalAmountPaise - discountAmountPaise);
    const dueAmountPaise = toPaise(order.due_amount);

    let buttonsHTML = '';

    // 1. Action for PENDING or PREPARING (RED/Active)
    if (currentStatus === 'pending') {
        buttonsHTML = `
            <button onclick="updateStatusToPreparing('${orderId}')" style="margin-right: 5px; background-color: #e67e22;">Order Received</button>
            <button onclick="showModifyOrderModal('${orderId}')" style="background-color: #e74c3c; margin-right: 5px;">Modify / Cancel</button>
        `;
    } else if (currentStatus === 'preparing') {
        buttonsHTML = `
            <button onclick="updateStatusToServed('${orderId}')" style="background-color: #27ae60; margin-right: 5px;">Order Ready</button>
            <button onclick="showModifyOrderModal('${orderId}')" style="background-color: #e74c3c; margin-right: 5px;">Modify / Cancel</button>
        `;
    }
    // 2. Action for SERVED or PARTIALLY PAID (YELLOW) 
    else if (currentStatus === 'served' || currentStatus === 'partially_paid') {
        // If served, the full net bill is due. If partially_paid, only the due amount is the payment target.
        const amountToPayNowPaise = currentStatus === 'partially_paid' ? dueAmountPaise : finalAmountPaise;

        const buttonText = currentStatus === 'partially_paid'
            ? `Finalize Payment (Rs. ${formatPaiseToRupees(dueAmountPaise)} Due)`
            : `Mark Paid (Rs. ${formatPaiseToRupees(finalAmountPaise)})`;

        buttonsHTML = `
            <button onclick="showPaymentModal('${orderId}', ${finalAmountPaise}, ${amountToPayNowPaise})" style="background-color: #f1c40f; margin-right: 5px; min-width: 150px;">${buttonText}</button>
            <button onclick="showModifyOrderModal('${orderId}')" style="background-color: #e67e22; margin-right: 5px;">Reduce Items</button>
        `;
    }
    // 3. Finalized/Paid/Cancelled orders (GREEN/GRAY)
    else if (currentStatus === 'paid') {
        buttonsHTML = `<span style="color: var(--success); font-weight: bold; margin-right: 10px;">${getOrderStatusLabel(order)}</span>`;
    } else if (currentStatus === 'cancelled') {
        buttonsHTML = `<span style="color: var(--danger); font-style: italic; margin-right: 10px;">CANCELLED</span>`;
    } else {
        buttonsHTML = `<span style="color: var(--text-secondary); margin-right: 10px;">${currentStatus.toUpperCase().replace('_', ' ')}</span>`;
    }

    // Always append a Print Receipt button
    buttonsHTML += `<button onclick="showReceiptModal('${orderId}')" style="background-color: #334155; border: 1px solid var(--border-color); color: var(--text-primary); margin-left: 2px;" title="Print Receipt">🖨️ Print</button>`;

    return buttonsHTML;
}


// --- Payment Modal Functions (Standard) ---

function showPaymentModal(orderId, netTotalAmountPaise, amountToPayNowPaise) {
    const modal = document.getElementById('payment-modal');

    document.getElementById('modal-title').textContent = `Complete Payment for Order #${orderId.substring(0, 8)}...`;
    document.getElementById('modal-total-amount').textContent = `Rs. ${formatPaiseToRupees(amountToPayNowPaise)}`;
    document.getElementById('modal-order-id').value = orderId;
    document.getElementById('modal-order-total-due').value = amountToPayNowPaise; // *** Integer Paise stored here ***

    document.getElementById('both-payment-inputs').style.display = 'none';

    document.getElementById('input-cash-amount').value = '';
    document.getElementById('input-online-amount').value = formatPaiseToRupees(amountToPayNowPaise);

    modal.style.display = 'flex';
}

function calculateRemainingOnline() {
    const totalDuePaise = parseInt(document.getElementById('modal-order-total-due').value); // Integer Paise
    const cashAmountInput = document.getElementById('input-cash-amount');
    const onlineAmountInput = document.getElementById('input-online-amount');

    // Convert input Rupees to integer Paise for calculation
    const cashAmountPaise = toPaise(cashAmountInput.value);

    if (cashAmountPaise < 0) {
        cashAmountInput.value = '';
        cashAmountInput.style.backgroundColor = '#fce4ec';
        return;
    } else {
        cashAmountInput.style.backgroundColor = 'white';
    }

    // Safe integer math
    const remainingPaise = totalDuePaise - cashAmountPaise;

    // Convert result back to Rupees for display
    onlineAmountInput.value = formatPaiseToRupees(remainingPaise);
}

function handlePaymentSelection(type) {
    const totalDuePaise = parseInt(document.getElementById('modal-order-total-due').value); // Integer Paise
    const bothInputs = document.getElementById('both-payment-inputs');

    closeModal(); // Close modal first if using simple payment types

    bothInputs.style.display = 'none';

    if (type === 'both') {
        // Re-show the modal for mixed payment calculation
        const modal = document.getElementById('payment-modal');
        modal.style.display = 'flex';

        document.getElementById('input-cash-amount').value = '';
        document.getElementById('input-online-amount').value = formatPaiseToRupees(totalDuePaise);
        bothInputs.style.display = 'block';

    } else if (type === 'cash') {
        processPayment(totalDuePaise, 0);
    } else if (type === 'online') {
        processPayment(0, totalDuePaise);
    }
}


function processMixedPayment() {
    const totalDuePaise = parseInt(document.getElementById('modal-order-total-due').value); // Integer Paise

    // Convert input Rupees to integer Paise
    const cashAmountPaise = toPaise(document.getElementById('input-cash-amount').value);
    const onlineAmountPaise = toPaise(document.getElementById('input-online-amount').value);

    // Sum is calculated using safe integers
    const sumPaise = cashAmountPaise + onlineAmountPaise;

    if (isNaN(cashAmountPaise) || isNaN(onlineAmountPaise) || cashAmountPaise < 0 || onlineAmountPaise < 0) {
        alert("Error: Please enter valid, non-negative numbers for both amounts.");
        return;
    }

    if (sumPaise !== totalDuePaise) {
        alert(`❌ Validation Error! The total amount entered (Rs. ${formatPaiseToRupees(sumPaise)}) does not match the Total Due (Rs. ${formatPaiseToRupees(totalDuePaise)}). Please adjust the Cash amount and try again.`);
        return;
    }

    closeModal(); // Close modal upon successful validation
    processPayment(cashAmountPaise, onlineAmountPaise); // Pass integer Paise values
}


async function processPayment(cashAmountPaise, onlineAmountPaise) {
    const orderId = document.getElementById('modal-order-id').value;

    const originalOrder = ordersData.find(o => o.id === orderId);
    if (!originalOrder) {
        alert("Error: Original order data not found.");
        return;
    }

    // Convert all existing amounts to integer Paise
    const originalCashPaise = toPaise(originalOrder.cash_amount);
    const originalOnlinePaise = toPaise(originalOrder.online_amount);
    // Use Math.round for net total calculation
    const orderNetTotalPaise = Math.round(toPaise(originalOrder.total_amount) - toPaise(originalOrder.discount_amount));

    // Integer math is safe
    const newCashTotalPaise = originalCashPaise + cashAmountPaise;
    const newOnlineTotalPaise = originalOnlinePaise + onlineAmountPaise;
    const newTotalPaidPaise = newCashTotalPaise + newOnlineTotalPaise;

    let newStatus = 'paid';
    let newDueAmountPaise = 0;

    // PERFECT CALCULATION: Compare integer Paise values directly
    if (newTotalPaidPaise >= orderNetTotalPaise) {
        newStatus = 'paid';
    } else if (newTotalPaidPaise > 0 && newTotalPaidPaise < orderNetTotalPaise) {
        newStatus = 'partially_paid';
        newDueAmountPaise = orderNetTotalPaise - newTotalPaidPaise;
    } else {
        // If payment somehow resulted in 0 paid and it was an open order, revert to served
        newStatus = 'served';
    }


    const { error } = await supabase
        .from('orders')
        .update({
            status: newStatus,
            // Convert back to Rupees (string/float) for database schema consistency
            cash_amount: formatPaiseToRupees(newCashTotalPaise),
            online_amount: formatPaiseToRupees(newOnlineTotalPaise),
            due_amount: formatPaiseToRupees(newDueAmountPaise)
        })
        .eq('id', orderId);

    if (error) {
        console.error("Supabase Payment Error:", error);
        alert('❌ Failed to record payment: ' + error.message);
    } else {
        alert(`✅ Payment recorded successfully! Status updated to ${newStatus.toUpperCase().replace('_', ' ')}.`);
        updateOrderInState(orderId, {
            status: newStatus,
            cash_amount: formatPaiseToRupees(newCashTotalPaise),
            online_amount: formatPaiseToRupees(newOnlineTotalPaise),
            due_amount: formatPaiseToRupees(newDueAmountPaise)
        });
    }
}

function closeModal() {
    document.getElementById('payment-modal').style.display = 'none';
}


// Helper function for simple status updates (not paid)
async function updateStatusToPreparing(orderId) {
    const { error } = await supabase.from('orders').update({ status: 'preparing' }).eq('id', orderId);
    if (error) { alert('Failed to update status: ' + error.message); } else { updateOrderInState(orderId, { status: 'preparing' }); }
}

async function updateStatusToServed(orderId) {
    const order = ordersData.find(o => o.id === orderId);
    if (!order) {
        alert('Order not found.');
        return;
    }
    const currentItemCount = order.order_items ? order.order_items.length : 0;

    const { error } = await supabase
        .from('orders')
        .update({
            status: 'served',
            // CRITICAL FIX: Set served_item_count to the full current length when manually marking as ready/served
            served_item_count: currentItemCount
        })
        .eq('id', orderId);

    if (error) {
        alert('Failed to update status: ' + error.message);
    } else {
        updateOrderInState(orderId, {
            status: 'served',
            served_item_count: currentItemCount
        });
    }
}

/**
 * Central function to show the modal for reducing/modifying items.
 */
function showModifyOrderModal(orderId) {
    const modal = document.getElementById('reduce-order-modal');
    const order = ordersData.find(o => o.id === orderId);
    if (!order) return;

    // Ensure the modal title is appropriate
    document.getElementById('reduce-modal-title').textContent = `Modify Order #${orderId.substring(0, 8)}`;

    // --- ADDED A BUTTON TO DELETE THE ENTIRE ORDER WITHIN THE MODAL ---
    const deleteButtonContainer = document.getElementById('reduce-modal-delete-container');
    if (deleteButtonContainer) {
        deleteButtonContainer.innerHTML = `
            <button onclick="deleteOrderPermanently('${orderId}')" 
                class="delete-order-btn">
                Permanently Delete ENTIRE Tab
            </button>
        `;
    }
    // ---------------------------------------------------------------------------

    document.getElementById('reduce-modal-order-id').value = orderId;
    const itemListDiv = document.getElementById('reduce-modal-item-list');
    itemListDiv.innerHTML = '';

    let currentTotalPaise = 0;

    // Display items and current quantities
    order.order_items.forEach((item, index) => {
        // Convert item price to integer Paise
        const itemPricePaise = toPaise(item.price);
        const itemTotalPaise = item.qty * itemPricePaise;
        currentTotalPaise += itemTotalPaise;

        // Items that have been previously served/logged (Visual indicator)
        const isServed = order.served_item_count && index < order.served_item_count;

        const servedWarning = isServed
            ? `<span class="served-item-warning">(Served/Old)</span>`
            : '';

        // The input max value ensures we can only reduce, not increase.
        itemListDiv.innerHTML += `
            <div class="reduce-item-row" data-index="${index}">
                <span class="reduce-item-name">${item.item} ${servedWarning}</span>
                <span class="reduce-item-qty">${item.qty}</span>
                <div class="reduce-item-controls">
                    <input type="number" 
                       id="reduce-qty-${index}" 
                       value="${item.qty}" 
                       min="0" 
                       max="${item.qty}" 
                       data-index="${index}"
                       data-price-paise="${itemPricePaise}"
                       title="${isServed ? 'This item was already served, modify quantity carefully.' : 'Modify quantity or set to 0 to remove.'}">
                    <span id="reduction-price-${index}" style="width: 45%; text-align: right;">Rs. ${formatPaiseToRupees(itemTotalPaise)}</span>
                </div>
            </div>
        `;
    });

    itemListDiv.querySelectorAll('input[type="number"]').forEach(input => {
        input.addEventListener('input', updateReductionPreview);
    });

    document.getElementById('reduce-modal-current-total').textContent = `Rs. ${formatPaiseToRupees(currentTotalPaise)}`;
    document.getElementById('reduce-modal-new-total').textContent = `Rs. ${formatPaiseToRupees(currentTotalPaise)}`;

    modal.style.display = 'flex';
}

/**
 * ONLY triggered from INSIDE the Modify Modal when a full tab deletion is required.
 */
async function deleteOrderPermanently(orderId) {
    if (!confirm(`⚠️ FINAL WARNING: This action will permanently DELETE Order #${orderId.substring(0, 8)}... and ALL its history. Confirm to proceed.`)) {
        return;
    }

    closeReduceModal();

    const orderToCancel = ordersData.find(o => o.id === orderId);
    const tableNumber = orderToCancel ? orderToCancel.table_number : null;

    const { error: deleteError } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderId);

    if (deleteError) {
        alert('Failed to delete order: ' + deleteError.message);
        return;
    }

    if (tableNumber) {
        // Optional: Clean up potential residual active orders for the table
        const { error: cleanupError } = await supabase
            .from('orders')
            .update({ status: 'cancelled' })
            .eq('table_number', tableNumber)
            .not('id', 'eq', orderId)
            .not('status', 'in', '("paid", "cancelled")');

        if (cleanupError) {
            console.warn("Could not clean up duplicate active orders for table:", cleanupError.message);
        }
    }

    removeOrderFromState(orderId);
    alert(`✅ Order #${orderId.substring(0, 8)}... permanently deleted.`);
}

// --- ITEM REDUCTION/RETURN LOGIC (Standard) ---

function updateReductionPreview(event) {
    const input = event.target;
    const index = input.dataset.index;
    const currentQty = parseInt(input.max);
    let newQty = parseInt(input.value) || 0;

    const pricePaise = parseInt(input.dataset.pricePaise);

    if (newQty > currentQty) newQty = currentQty;
    if (newQty < 0 || isNaN(newQty)) newQty = 0;
    input.value = newQty;

    document.getElementById(`reduction-price-${index}`).textContent = `Rs. ${formatPaiseToRupees(newQty * pricePaise)}`;

    // Recalculate global total
    const orderId = document.getElementById('reduce-modal-order-id').value;
    const order = ordersData.find(o => o.id === orderId);
    let newTotalPaise = 0;

    order.order_items.forEach((item, idx) => {
        const itemInput = document.getElementById(`reduce-qty-${idx}`);
        // Check if the input element exists before reading its data
        if (itemInput) {
            const itemPricePaise = parseInt(itemInput.dataset.pricePaise);
            const finalQty = parseInt(itemInput.value) || 0;

            newTotalPaise += finalQty * itemPricePaise;
        }
    });

    document.getElementById('reduce-modal-new-total').textContent = `Rs. ${formatPaiseToRupees(newTotalPaise)}`;
}


// 🔥 UPDATED FUNCTION: Includes logic to prompt for and save customer_message
async function processOrderReduction() {
    const orderId = document.getElementById('reduce-modal-order-id').value;
    const order = ordersData.find(o => o.id === orderId);

    let newItems = [];
    let newTotalAmountPaise = 0;
    let itemsRemoved = false;
    let itemsQuantityChanged = false;
    let reductionMessage = null; // New variable for the customer message

    // Calculate amount paid (in integer Paise).
    const amountPaidPaise = toPaise(order.cash_amount) + toPaise(order.online_amount);

    // Loop through modal inputs and build the new items array
    order.order_items.forEach((item, index) => {
        const input = document.getElementById(`reduce-qty-${index}`);

        if (!input) return;

        const newQty = parseInt(input.value) || 0;
        const oldQty = item.qty;

        const itemPricePaise = parseInt(input.dataset.pricePaise);

        if (newQty !== oldQty) {
            itemsQuantityChanged = true;
            if (newQty < oldQty) {
                // If quantity decreased, flag removal.
                itemsRemoved = true;
            }
        }

        if (newQty > 0) {
            newItems.push({
                ...item,
                qty: newQty,
                price: parseFloat(formatPaiseToRupees(itemPricePaise))
            });

            newTotalAmountPaise += newQty * itemPricePaise;
        }
    });

    // Handle full deletion case (no change here)
    if (newItems.length === 0) {
        if (!confirm('Warning: Reducing all items will result in a ZERO bill. Do you want to cancel and delete the order instead?')) {
            return;
        }
        closeReduceModal();
        await deleteOrderPermanently(orderId);
        return;
    }

    // --- NEW: PROMPT FOR CUSTOMER MESSAGE IF ITEMS WERE MODIFIED ---
    if (itemsQuantityChanged) {
        let defaultMessage = "";

        if (itemsRemoved) {
            defaultMessage = "An item was removed/reduced from your tab due to unavailability or kitchen changes. Please review the updated bill.";
        } else {
            defaultMessage = "Your order was modified by the administration. Please check the updated items.";
        }

        const messageInput = prompt("Order items were modified. Please enter a message for the customer (leave blank for no message):", defaultMessage);

        if (messageInput !== null && messageInput.trim() !== "") {
            reductionMessage = messageInput.trim();
        }
    }
    // --- END OF NEW PROMPT ---

    // --- CRITICAL STATUS/DUE CALCULATION ---
    let newDueAmountPaise = 0;
    let newStatus;
    let newServedCount = 0;

    if (newTotalAmountPaise <= amountPaidPaise) {
        newStatus = 'paid';
        newDueAmountPaise = 0;

    } else {
        newDueAmountPaise = newTotalAmountPaise - amountPaidPaise;

        if (order.status === 'pending' || order.status === 'preparing' || order.status === 'served') {
            // If reducing items, assume the items that remain are now "served" or partially paid
            newStatus = amountPaidPaise > 0 ? 'partially_paid' : 'served';
        }
        else {
            newStatus = 'partially_paid';
        }

        // CRITICAL FIX: Reset served_item_count to the NEW total length.
        newServedCount = newItems.length;
    }
    // --- END OF CRITICAL STATUS/DUE CALCULATION ---

    // Update Supabase
    const { error } = await supabase
        .from('orders')
        .update({
            order_items: newItems,
            total_amount: formatPaiseToRupees(newTotalAmountPaise),
            due_amount: formatPaiseToRupees(newDueAmountPaise),
            status: newStatus,
            served_item_count: newServedCount,
            // 🔥 NEW: Pass the message to the database
            customer_message: reductionMessage
        })
        .eq('id', orderId);

    closeReduceModal();

    if (error) {
        alert('❌ Failed to reduce order items: ' + error.message);
    } else {
        alert(`✅ Order items and total amount updated successfully. New Status: ${newStatus.toUpperCase().replace('_', ' ')}.${reductionMessage ? ' Customer will see a notification.' : ''}`);
        updateOrderInState(orderId, {
            order_items: newItems,
            total_amount: formatPaiseToRupees(newTotalAmountPaise),
            due_amount: formatPaiseToRupees(newDueAmountPaise),
            status: newStatus,
            served_item_count: newServedCount,
            customer_message: reductionMessage
        });
    }
}

function closeReduceModal() {
    document.getElementById('reduce-order-modal').style.display = 'none';
}


// --- 4. DAILY SUMMARY (Standard) ---

function updateDailySummary() {
    let openCount = 0;
    const dailyTotals = ordersData.reduce((totals, order) => {
        const isSales = order.status === 'paid';
        if (isSales) {
            totals.total += toPaise(order.total_amount);
            totals.cash += toPaise(order.cash_amount);
            totals.online += toPaise(order.online_amount);
        }
        if (order.status !== 'paid' && order.status !== 'cancelled') {
            openCount++;
        }
        return totals;
    }, { total: 0, cash: 0, online: 0 });

    const dailySummaryElement = document.getElementById('daily-summary');
    if (dailySummaryElement) {
        dailySummaryElement.innerHTML = `
            <strong>Total Sales (Paid Orders): Rs. ${formatPaiseToRupees(dailyTotals.total)}</strong><br>
            (Cash: Rs. ${formatPaiseToRupees(dailyTotals.cash)} | Online: Rs. ${formatPaiseToRupees(dailyTotals.online)})
        `;
    }

    // Populate the modern stats elements
    const totalRevEl = document.getElementById('stat-total-revenue');
    const cashRevEl = document.getElementById('stat-cash-revenue');
    const onlineRevEl = document.getElementById('stat-online-revenue');
    const openOrdersEl = document.getElementById('stat-open-orders');

    if (totalRevEl) totalRevEl.textContent = `Rs. ${formatPaiseToRupees(dailyTotals.total)}`;
    if (cashRevEl) cashRevEl.textContent = `Rs. ${formatPaiseToRupees(dailyTotals.cash)}`;
    if (onlineRevEl) onlineRevEl.textContent = `Rs. ${formatPaiseToRupees(dailyTotals.online)}`;
    if (openOrdersEl) openOrdersEl.textContent = openCount;
}


// --- 5. EXPORT FUNCTION (FULLY REVISED AND FIXED) ---

/**
 * Enhanced CSV export function to include all requested fields and sales totals.
 */
function exportOrders() {

    const exportableOrders = ordersData;

    if (exportableOrders.length === 0) {
        alert("No orders to export for the selected date.");
        return;
    }

    // Calculate Summary Totals for the selected date's paid orders
    const dailyTotals = exportableOrders.reduce((totals, order) => {
        if (order.status === 'paid') {
            totals.total += toPaise(order.total_amount);
            totals.cash += toPaise(order.cash_amount);
            totals.online += toPaise(order.online_amount);
        }
        return totals;
    }, { total: 0, cash: 0, online: 0 });

    // Helper to safely format item list for CSV (handles quotes and commas)
    function formatItemsForCSV(items) {
        if (!items || items.length === 0) return 'N/A';
        const itemList = items.map(item => `${item.item} x${item.qty} @ Rs.${(item.price || 0).toFixed(2)}`).join('; ');
        // Enclose in quotes and escape internal quotes for safe CSV export
        return `"${itemList.replace(/"/g, '""')}"`;
    }

    // 2. Build the CSV Header: Now includes Date and Time split, and all columns in the correct order.
    let csv = "ID,Table Number,Date,Time,Status,Net Total,Discount,Cash Paid,Online Paid,Due Amount,Items List,Admin Message\n";

    // 3. Build the CSV Rows (Order Data)
    exportableOrders.forEach(order => {
        // Extract Date and Time separately
        const createdDate = new Date(order.created_at);
        const orderDate = createdDate.toLocaleDateString();
        const orderTime = createdDate.toLocaleTimeString();

        // CRITICAL: Order MUST match the header above (ID, Table, Date, Time, Status, Net Total, Discount...)
        const row = [
            order.id,
            order.table_number,
            orderDate,
            orderTime,
            order.status.toUpperCase().replace('_', ' '),
            (order.total_amount || 0), // This is the Net Total before discount
            (order.discount_amount || 0),
            (order.cash_amount || 0),
            (order.online_amount || 0),
            (order.due_amount || 0),
            formatItemsForCSV(order.order_items),
            `"${(order.customer_message || '').replace(/"/g, '""')}"`
        ].join(',');

        csv += row + "\n";
    });

    // 4. Add the Summary Totals at the end
    csv += "\n\n";
    csv += "--- DAILY SALES SUMMARY ---\n";
    csv += `Total Sales (Paid Orders),Rs. ${formatPaiseToRupees(dailyTotals.total)}\n`;
    csv += `Cash Collected,Rs. ${formatPaiseToRupees(dailyTotals.cash)}\n`;
    csv += `Online Payments,Rs. ${formatPaiseToRupees(dailyTotals.online)}\n`;


    // 5. Trigger the Download (same as before)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const selectedDate = document.getElementById('date-filter').value;
    a.href = url;
    a.download = `orders_export_${selectedDate}.csv`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- 6. MENU MANAGEMENT FUNCTIONS (Standard) ---

async function fetchMenuForAdmin() {
    const { data: menu, error } = await supabase
        .from('menus')
        .select('*')
        .order('category, item_name', { ascending: true });

    if (error) {
        console.error('Error fetching menu for admin:', error);
        return;
    }
    setMenuState(menu);
}

function renderMenuManagement(menu) {
    const menuList = document.getElementById('menu-list');
    if (!menuList) return;
    menuList.innerHTML = '';

    menu.forEach(item => {
        const row = menuList.insertRow();
        row.dataset.itemId = item.id;

        const safeItemName = item.item_name.replace(/'/g, "\\'");
        const displayCategory = standardizeCategoryName(item.category);

        row.innerHTML = `
            <td>${item.item_name} ${item.is_special ? '✨' : ''}</td>
            <td>${displayCategory}</td>
            <td>Rs. ${item.price.toFixed(2)}</td>
            <td>${item.is_available ? '✅ Yes' : '❌ No'}</td>
            <td>
                <button onclick="showEditModal('${item.id}')" style="background-color: #3498db; margin-right: 5px;">Edit</button>
                <button onclick="deleteMenuItem('${item.id}', '${safeItemName}')" style="background-color: #e74c3c;">Delete</button>
            </td>
        `;
    });
}

function showEditModal(itemId) {
    const item = menuCache.find(i => i.id === itemId);

    if (!item) {
        alert('Item data not found in cache.');
        return;
    }

    document.getElementById('edit-item-id').value = item.id;
    document.getElementById('edit-item-name').value = item.item_name;
    document.getElementById('edit-item-category').value = standardizeCategoryName(item.category);
    document.getElementById('edit-item-price').value = item.price.toFixed(2);
    document.getElementById('edit-item-available').checked = item.is_available;

    document.getElementById('edit-item-special').checked = item.is_special;

    document.getElementById('edit-menu-modal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('edit-menu-modal').style.display = 'none';
}


async function processEdit() {
    const itemId = document.getElementById('edit-item-id').value;
    const newName = document.getElementById('edit-item-name').value.trim();
    const newCategory = document.getElementById('edit-item-category').value.trim();
    const newPrice = parseFloat(document.getElementById('edit-item-price').value);
    const isAvailable = document.getElementById('edit-item-available').checked;

    const isSpecial = document.getElementById('edit-item-special').checked;

    if (!newName || !newCategory || isNaN(newPrice) || newPrice <= 0) {
        alert('Please ensure Name, Category are valid, and Price is greater than zero.');
        return;
    }

    // Ensure the price is saved to the DB rounded to two decimal places
    const cleanPrice = newPrice.toFixed(2);

    const databaseCategory = newCategory.toLowerCase();

    const updates = {
        item_name: newName,
        category: databaseCategory,
        price: cleanPrice, // Use the cleaned price
        is_available: isAvailable,
        is_special: isSpecial
    };

    closeEditModal();

    const { error } = await supabase
        .from('menus')
        .update(updates)
        .eq('id', itemId);

    if (error) {
        alert('❌ Failed to update menu item: ' + error.message);
    } else {
        alert(`✅ Menu item updated successfully!`);
        upsertMenuItemState({
            id: itemId,
            item_name: newName,
            category: databaseCategory,
            price: parseFloat(cleanPrice),
            is_available: isAvailable,
            is_special: isSpecial
        });
    }
}

async function deleteMenuItem(itemId, itemName) {
    if (!confirm(`Are you sure you want to PERMANENTLY delete the item: ${itemName}?`)) {
        return;
    }

    const { error } = await supabase
        .from('menus')
        .delete()
        .eq('id', itemId);

    if (error) {
        console.error('Supabase Delete Error:', error);
        alert('❌ Failed to delete menu item: ' + error.message);
    } else {
        alert(`✅ Item "${itemName}" deleted successfully!`);
        removeMenuItemState(itemId);
    }
}

async function handleNewItemCreation(e) {
    e.preventDefault();

    const form = e.target;
    const messageEl = document.getElementById('menu-management-message');

    const itemName = document.getElementById('new-item-name').value.trim();
    const category = document.getElementById('new-item-category').value.trim();
    const price = parseFloat(document.getElementById('new-item-price').value);
    const isAvailable = document.getElementById('new-item-available').checked;

    const isSpecial = document.getElementById('new-item-special').checked || false;

    if (!itemName || !category || isNaN(price) || price <= 0) {
        messageEl.className = 'error';
        messageEl.textContent = '❌ Please fill out all fields with valid data.';
        return;
    }

    // Ensure the price is saved to the DB rounded to two decimal places
    const cleanPrice = price.toFixed(2);

    const databaseCategory = category.toLowerCase();

    messageEl.textContent = 'Adding item...';
    messageEl.className = '';

    const { data, error } = await supabase
        .from('menus')
        .insert([
            {
                item_name: itemName,
                category: databaseCategory,
                price: cleanPrice, // Use the cleaned price
                is_available: isAvailable,
                is_special: isSpecial
            }
        ])
        .select('*');

    if (error) {
        messageEl.className = 'error';
        if (error.code === '23505') {
            messageEl.textContent = `❌ Failed to add item: Item name "${itemName}" already exists.`;
        } else {
            messageEl.textContent = `❌ Failed to add item: ${error.message}`;
        }
    } else {
        messageEl.className = 'success';
        messageEl.textContent = `✅ Item "${itemName}" added successfully!`;
        form.reset();
        if (Array.isArray(data) && data[0]) {
            upsertMenuItemState(data[0]);
        } else {
            await fetchMenuForAdmin();
        }
    }
}

// --- 7. REALTIME NOTIFICATION SYSTEM ---

/**
 * Updates the LIVE badge in the header to show realtime connection state.
 */
function setLiveBadge(isOnline) {
    const badge = document.getElementById('live-badge');
    const dot = document.getElementById('live-dot');
    if (!badge || !dot) return;

    if (isOnline) {
        badge.classList.remove('offline');
        dot.classList.remove('offline');
    } else {
        badge.classList.add('offline');
        dot.classList.add('offline');
    }
}

/**
 * Shows a beautiful in-app slide-down banner when new orders arrive.
 * Works regardless of browser notification permission.
 */
let _bannerDismissTimer = null;

function showNewOrderBanner(order, type) {
    const banner = document.getElementById('new-order-banner');
    if (!banner) return;

    if (_bannerDismissTimer) {
        clearTimeout(_bannerDismissTimer);
        _bannerDismissTimer = null;
    }

    banner.className = 'new-order-alert-banner';

    const isNew = type === '🔔 NEW ORDER';
    const icon = isNew ? '🔔' : '➕';
    const title = isNew
        ? `New Order — Table ${order.table_number}`
        : `Items Added — Table ${order.table_number}`;
    const desc = isNew
        ? `Rs. ${formatPaiseToRupees(toPaise(order.total_amount))} • ${(order.order_items || []).length} item(s)`
        : `${(order.order_items || []).length} item(s) now in the tab`;

    banner.innerHTML = `
        <span class="alert-banner-icon">${icon}</span>
        <div class="alert-banner-body">
            <div class="alert-banner-title">${title}</div>
            <div class="alert-banner-desc">${desc}</div>
        </div>
        <button class="alert-banner-action" id="new-order-received-btn">Received</button>
    `;

    // Show
    void banner.offsetWidth;
    banner.classList.add('show');

    const receivedBtn = document.getElementById('new-order-received-btn');
    if (receivedBtn) {
        receivedBtn.addEventListener('click', () => {
            banner.classList.remove('show');
        });
        receivedBtn.focus();
    }
}

function showPaymentReceivedBanner(order) {
    const paidAmount = formatPaiseToRupees(toPaise(order.total_amount));
    const icon = '💳';
    const title = `Payment Received — Table ${order.table_number}`;
    const desc = order.customer_message || `Rs. ${paidAmount} paid • order marked as completed`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-alert-overlay';
    overlay.style.zIndex = '999999';
    overlay.innerHTML = `
        <div class="modal-alert-card" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.95) 0%, rgba(245, 158, 11, 0.95) 100%); color: white; border: 2px solid rgba(255,255,255,0.2);">
            <div class="modal-alert-icon" style="background: rgba(255,255,255,0.2); font-size: 32px;">${icon}</div>
            <div class="modal-alert-title" style="color: white; font-size: 1.4rem;">${title}</div>
            <div class="modal-alert-text" style="color: rgba(255,255,255,0.9); font-size: 1.1rem; margin-bottom: 24px;">${desc}</div>
            <button class="modal-alert-btn payment-received-btn" style="background: white; color: #040815; font-size: 1.1rem; padding: 12px; font-weight: bold; width: 100%;">Received</button>
        </div>
    `;

    document.body.appendChild(overlay);

    // Show
    void overlay.offsetWidth;
    overlay.classList.add('show');

    const receivedBtn = overlay.querySelector('.payment-received-btn');
    if (receivedBtn) {
        receivedBtn.addEventListener('click', () => {
            overlay.classList.remove('show');
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 300);
        });
        receivedBtn.focus();
    }
}

function triggerPaymentReceivedNotification(order) {
    showPaymentReceivedBanner(order);
    playNotificationSound();

    if (Notification.permission === 'granted') {
        new Notification('Payment Received', {
            body: `Table ${order.table_number} paid Rs. ${formatPaiseToRupees(toPaise(order.total_amount))}`,
            icon: 'favicon.svg'
        });
    } else {
        Notification.requestPermission();
    }
}

function playNotificationSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        // Chime sound: two synthesized sine notes
        const now = ctx.currentTime;
        
        // First Note: E5 (659.25 Hz)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(659.25, now);
        gain1.gain.setValueAtTime(0.15, now);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.1);
        
        // Second Note: A5 (880 Hz)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, now + 0.08);
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.setValueAtTime(0.15, now + 0.08);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.08);
        osc2.stop(now + 0.45);
    } catch (e) {
        console.warn('Web Audio playback failed or blocked:', e);
    }
}

function triggerNewOrderNotification(order, type) {
    // 1. Always show the in-app banner (no permission needed)
    showNewOrderBanner(order, type);

    // 2. Play synthesized alert chime
    playNotificationSound();

    // 3. Optionally send a browser notification if permission is already granted
    if (Notification.permission === 'granted') {
        const bodyText = type === '🔔 NEW ORDER'
            ? `New Order for Table ${order.table_number}. Total: Rs. ${formatPaiseToRupees(toPaise(order.total_amount))}`
            : `Table ${order.table_number} added more items to their open tab!`;

        new Notification(type, {
            body: bodyText,
            icon: 'favicon.svg'
        });
    } else {
        // Silently request permission for future notifications (no early return)
        Notification.requestPermission();
    }
}

// --- 8. RECEIPT PRINTING MODAL HANDLERS ---

function showReceiptModal(orderId) {
    const order = ordersData.find(o => o.id === orderId);
    if (!order) {
        alert("Error: Order data not found.");
        return;
    }

    const printArea = document.getElementById('receipt-print-area');
    const createdDate = new Date(order.created_at);
    
    let itemsHTML = '';
    let subtotalPaise = 0;
    
    order.order_items.forEach(item => {
        const itemPricePaise = toPaise(item.price);
        const itemTotalPaise = item.qty * itemPricePaise;
        subtotalPaise += itemTotalPaise;
        
        itemsHTML += `
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span>${item.item} x${item.qty}</span>
                <span>Rs. ${formatPaiseToRupees(itemTotalPaise)}</span>
            </div>
        `;
    });

    const totalPaise = toPaise(order.total_amount);
    const discountPaise = toPaise(order.discount_amount);
    const duePaise = toPaise(order.due_amount);
    const cashPaise = toPaise(order.cash_amount);
    const onlinePaise = toPaise(order.online_amount);

    printArea.innerHTML = `
        <div style="text-align: center; margin-bottom: 15px;">
            <h2 style="margin: 0 0 5px 0; font-size: 20px; font-weight: bold; letter-spacing: 1px;">THE CHAKRA</h2>
            <p style="margin: 0; font-size: 12px; color: #555;">Smart POS Restaurant System</p>
        </div>
        <div style="border-bottom: 1px dashed #333; margin-bottom: 10px; padding-bottom: 5px; font-size: 12px;">
            <div><strong>Order ID:</strong> #${order.id.substring(0, 8).toUpperCase()}</div>
            <div><strong>Table Number:</strong> ${order.table_number.toUpperCase()}</div>
            <div><strong>Date:</strong> ${createdDate.toLocaleDateString()}  <strong>Time:</strong> ${createdDate.toLocaleTimeString()}</div>
            <div><strong>Status:</strong> ${getOrderStatusLabel(order)}</div>
        </div>
        <div style="margin-bottom: 10px; font-size: 13px;">
            <div style="font-weight: bold; border-bottom: 1px solid #333; margin-bottom: 5px; padding-bottom: 2px;">ITEMS</div>
            ${itemsHTML}
        </div>
        <div style="border-top: 1px dashed #333; padding-top: 5px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span>Subtotal:</span>
                <span>Rs. ${formatPaiseToRupees(subtotalPaise)}</span>
            </div>
            ${discountPaise > 0 ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px; color: #e74c3c;">
                <span>Discount:</span>
                <span>- Rs. ${formatPaiseToRupees(discountPaise)}</span>
            </div>` : ''}
            <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 15px; margin-top: 5px; border-top: 1px solid #333; padding-top: 5px; margin-bottom: 5px;">
                <span>Total Amount:</span>
                <span>Rs. ${formatPaiseToRupees(totalPaise - discountPaise)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px; color: #555;">
                <span>Paid Cash:</span>
                <span>Rs. ${formatPaiseToRupees(cashPaise)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px; color: #555;">
                <span>Paid Online:</span>
                <span>Rs. ${formatPaiseToRupees(onlinePaise)}</span>
            </div>
            ${duePaise > 0 ? `
            <div style="display: flex; justify-content: space-between; font-weight: bold; color: #e74c3c; margin-top: 3px; border-top: 1px dashed #aaa; padding-top: 3px;">
                <span>Balance Due:</span>
                <span>Rs. ${formatPaiseToRupees(duePaise)}</span>
            </div>` : ''}
        </div>
        <div style="text-align: center; margin-top: 25px; border-top: 1px dashed #333; padding-top: 10px; font-size: 12px;">
            <p style="margin: 0;">Thank You for Your Visit!</p>
            <p style="margin: 3px 0 0 0; font-size: 10px; color: #777;">Powered by Chakra POS</p>
        </div>
    `;

    document.getElementById('receipt-modal').style.display = 'flex';
}

function closeReceiptModal() {
    document.getElementById('receipt-modal').style.display = 'none';
}

function printReceiptFromModal() {
    window.print();
}

// Start the dashboard logic if on dashboard page.
// NOTE: admin.js is loaded at the bottom of <body>, so the DOM is already
// fully parsed when this script executes — DOMContentLoaded has already fired.
// Calling initDashboard() directly is the correct approach here.
if (document.getElementById('orders-table')) {
    initDashboard();
}
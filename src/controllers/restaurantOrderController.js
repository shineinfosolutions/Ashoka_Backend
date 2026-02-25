const RestaurantOrder = require('../models/RestaurantOrder.js');
const MenuItem = require('../models/MenuItem.js');
const KOT = require('../models/KOT.js');
const RestaurantTable = require('../models/RestaurantTable.js');
const Variation = require('../models/Variation.js');
const Addon = require('../models/Addon.js');
const { createAuditLog } = require('../utils/auditLogger');
const mongoose = require('mongoose');


// Create new restaurant order with enhanced features
exports.createOrder = async (req, res) => {
  try {
    const orderData = req.body;
    
    // Generate unique order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    
    // Populate item details from MenuItem collection
    const itemsWithDetails = await Promise.all(
      orderData.items.map(async (item) => {
        const menuItem = await MenuItem.findById(item.itemId || item.menuId);
        if (!menuItem) throw new Error(`Menu item ${item.itemId || item.menuId} not found`);
        
        let variationData = null;
        let addonsData = [];
        let itemPrice = menuItem.Price || 0;
        
        // Fetch variation details if provided
        if (item.variation?.variationId) {
          const variation = await Variation.findById(item.variation.variationId);
          if (variation) {
            variationData = {
              variationId: variation._id.toString(),
              name: variation.name,
              price: variation.price
            };
            itemPrice = variation.price;
          }
        }
        
        // Fetch addon details if provided
        if (item.addons?.length > 0) {
          addonsData = await Promise.all(
            item.addons.map(async (addon) => {
              const addonDoc = await Addon.findById(addon.addonId);
              if (addonDoc) {
                itemPrice += addonDoc.price;
                return {
                  addonId: addonDoc._id.toString(),
                  name: addonDoc.name,
                  price: addonDoc.price
                };
              }
              return null;
            })
          );
          addonsData = addonsData.filter(a => a !== null);
        }
        
        return {
          menuId: item.itemId || item.menuId,
          name: item.itemName || menuItem.name,
          basePrice: menuItem.Price || 0,
          quantity: item.quantity,
          itemTotal: itemPrice * item.quantity,
          status: 'PENDING',
          timeToPrepare: item.timeToPrepare || menuItem.timeToPrepare || 15,
          variation: variationData,
          addons: addonsData,
          isFree: item.isFree || false,
          nocId: item.nocId || null
        };
      })
    );
    
    orderData.items = itemsWithDetails;
    
    // Calculate subtotal and total
    const subtotal = itemsWithDetails.reduce((sum, item) => sum + item.itemTotal, 0);
    const discountAmount = orderData.discount?.percentage ? (subtotal * orderData.discount.percentage / 100) : 0;
    const totalAmount = subtotal - discountAmount;
    
    // Calculate GST (use provided rates or defaults)
    const sgstRate = orderData.sgstRate || 2.5;
    const cgstRate = orderData.cgstRate || 2.5;
    const sgst = totalAmount * (sgstRate / 100);
    const cgst = totalAmount * (cgstRate / 100);
    const gst = sgst + cgst;
    
    const tableNumber = orderData.tableNumber || orderData.tableNo;
    
    // Update table status to occupied
    if (orderData.tableNumber || orderData.tableNo) {
      const tableNum = orderData.tableNumber || orderData.tableNo;
      console.log('Attempting to update table:', tableNum, 'Type:', typeof tableNum);
      const RestaurantTable = require('../models/RestaurantTable');
      
      // First check if table exists
      const existingTable = await RestaurantTable.findOne({ tableNumber: tableNum });
      console.log('Found table:', existingTable);
      
      if (existingTable) {
        const result = await RestaurantTable.findOneAndUpdate(
          { tableNumber: tableNum },
          { status: 'occupied' },
          { new: true }
        );
        console.log('Table updated successfully:', result);
      } else {
        console.log('Table not found with tableNumber:', tableNum);
      }
    }
    
    // Create order with enhanced schema
    const order = new RestaurantOrder({
      orderNumber,
      items: itemsWithDetails,
      extraItems: [],
      subtotal,
      totalAmount,
      customerName: orderData.customerName || orderData.staffName || 'Guest',
      customerPhone: orderData.customerPhone || orderData.phoneNumber || '',
      tableNumber,
      tableNo: tableNumber,
      tableId: orderData.tableId,
      guestCount: orderData.guestCount,
      staffName: orderData.staffName,
      phoneNumber: orderData.phoneNumber || orderData.customerPhone,
      notes: orderData.notes || '',
      status: 'PENDING',
      priority: 'NORMAL',
      discount: orderData.discount || {},
      gst,
      sgst,
      cgst,
      sgstRate,
      cgstRate,
      sgstAmount: sgst,
      cgstAmount: cgst,
      totalGstAmount: gst
    });
    
    await order.save();

    // Auto-create KOT
    try {
      const kot = new KOT({
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderType: 'restaurant',
        tableNumber: order.tableNumber || order.tableNo,
        customerName: order.customerName,
        items: itemsWithDetails.map(item => ({
          menuId: item.menuId,
          name: item.name,
          quantity: item.quantity,
          variation: item.variation,
          addons: item.addons,
          status: 'PENDING',
          timeToPrepare: item.timeToPrepare
        })),
        status: 'PENDING',
        priority: 'NORMAL'
      });
      await kot.save();
    } catch (kotError) {
      console.error('KOT creation error:', kotError);
    }

    // Create audit log
    createAuditLog('CREATE', 'RESTAURANT_ORDER', order._id, req.user?.id, req.user?.role, null, order.toObject(), req);

    res.status(201).json(order);
  } catch (error) {
    console.error('Create order error:', error);
    res.status(400).json({ error: error.message });
  }
};

// Get all orders
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await RestaurantOrder.find()
      .sort({ createdAt: -1 })
      .maxTimeMS(5000)
      .lean()
      .exec();
    
    // Ensure all orders have items array
    const sanitizedOrders = orders.map(order => ({
      ...order,
      items: order.items || [],
      extraItems: order.extraItems || []
    }));
    
    res.json(sanitizedOrders);
  } catch (error) {
    if (error.name === 'MongooseError' && error.message.includes('buffering timed out')) {
      res.status(408).json({ error: 'Database query timeout. Please try again.' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
};

// Update order status with KOT sync
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const originalOrder = await RestaurantOrder.findById(id);
    if (!originalOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = await RestaurantOrder.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );
    
    // Sync KOT status
    try {
      await KOT.updateMany({ orderId: id }, { status });
    } catch (kotError) {
      console.error('KOT sync error:', kotError);
    }
    
    // Update table status if order is completed
    if ((status === 'PAID' || status === 'CANCELLED') && order.tableNumber) {
      await RestaurantTable.findOneAndUpdate(
        { tableNumber: order.tableNumber },
        { status: 'available' }
      );
    }
    
    createAuditLog('UPDATE', 'RESTAURANT_ORDER', order._id, req.user?.id, req.user?.role, originalOrder.toObject(), order.toObject(), req);
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update item status in order
exports.updateItemStatus = async (req, res) => {
  try {
    const { orderId, itemIndex } = req.params;
    const { status } = req.body;

    const order = await RestaurantOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!order.items[itemIndex]) {
      return res.status(404).json({ error: 'Item not found' });
    }

    order.items[itemIndex].status = status;
    
    // Track preparation time
    if (status === 'PREPARING' && !order.items[itemIndex].startedAt) {
      order.items[itemIndex].startedAt = new Date();
    }
    if (status === 'READY') {
      if (!order.items[itemIndex].startedAt) {
        order.items[itemIndex].startedAt = new Date(Date.now() - 60000);
      }
      order.items[itemIndex].readyAt = new Date();
      const seconds = Math.round((order.items[itemIndex].readyAt - order.items[itemIndex].startedAt) / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      order.items[itemIndex].actualPrepTime = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    // Check if all items are SERVED and update order status to READY
    if (status === 'SERVED') {
      const allItemsServed = order.items.every(item => item.status === 'SERVED') &&
                             (!order.extraItems || order.extraItems.length === 0 || order.extraItems.every(item => item.status === 'SERVED'));
      
      if (allItemsServed && order.status !== 'READY') {
        order.status = 'READY';
      }
    }
    
    order.markModified('items');
    await order.save();

    // Sync with KOT
    try {
      const kot = await KOT.findOne({ orderId });
      if (kot && kot.items[itemIndex]) {
        kot.items[itemIndex].status = status;
        if (order.items[itemIndex].startedAt) {
          kot.items[itemIndex].startedAt = order.items[itemIndex].startedAt;
        }
        if (order.items[itemIndex].readyAt) {
          kot.items[itemIndex].readyAt = order.items[itemIndex].readyAt;
          kot.items[itemIndex].actualPrepTime = order.items[itemIndex].actualPrepTime;
        }
        kot.markModified('items');
        await kot.save();
      }
    } catch (kotError) {
      console.error('KOT sync error:', kotError);
    }

    res.json({ message: 'Item status updated successfully', order });
  } catch (error) {
    console.error('Update item status error:', error);
    res.status(500).json({ error: 'Failed to update item status' });
  }
};

// Add extra items to existing order
exports.addExtraItems = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { extraItems } = req.body;

    if (!extraItems || !extraItems.length) {
      return res.status(400).json({ error: 'Extra items are required' });
    }

    const order = await RestaurantOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const newExtraItems = await Promise.all(
      extraItems.map(async (item) => {
        const menuItem = await MenuItem.findById(item.menuItemId || item.menuId || item.itemId);
        if (!menuItem) throw new Error(`Menu item not found`);
        
        let itemPrice = item.variation?.price || menuItem.Price || 0;
        if (item.addons?.length > 0) {
          itemPrice += item.addons.reduce((sum, addon) => sum + (addon.price || 0), 0);
        }
        
        return {
          menuId: item.menuItemId || item.menuId || item.itemId,
          name: item.name || menuItem.itemName || menuItem.name,
          basePrice: menuItem.Price || menuItem.price || 0,
          quantity: item.quantity,
          itemTotal: itemPrice * item.quantity,
          status: 'PENDING',
          timeToPrepare: item.timeToPrepare || menuItem.timeToPrepare || 15,
          variation: item.variation || null,
          addons: item.addons || []
        };
      })
    );

    const extraTotal = newExtraItems.reduce((sum, item) => sum + item.itemTotal, 0);
    
    if (!order.extraItems) {
      order.extraItems = [];
    }
    order.extraItems.push(...newExtraItems);
    order.totalAmount = (order.totalAmount || 0) + extraTotal;
    order.markModified('extraItems');
    await order.save();

    // Sync with KOT
    try {
      const kot = await KOT.findOne({ orderId });
      if (kot) {
        if (!kot.extraItems) {
          kot.extraItems = [];
        }
        kot.extraItems.push(...newExtraItems.map(item => ({
          menuId: item.menuId,
          name: item.name,
          quantity: item.quantity,
          variation: item.variation,
          addons: item.addons,
          status: 'PENDING',
          timeToPrepare: item.timeToPrepare
        })));
        kot.markModified('extraItems');
        await kot.save();
      }
    } catch (kotError) {
      console.error('KOT sync error:', kotError);
    }

    res.json({ message: 'Extra items added successfully', order });
  } catch (error) {
    console.error('Add extra items error:', error);
    res.status(500).json({ error: 'Failed to add extra items', details: error.message });
  }
};

// Update extra item status
exports.updateExtraItemStatus = async (req, res) => {
  try {
    const { orderId, itemIndex } = req.params;
    const { status } = req.body;

    const order = await RestaurantOrder.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!order.extraItems || !order.extraItems[itemIndex]) {
      return res.status(404).json({ error: 'Extra item not found' });
    }

    order.extraItems[itemIndex].status = status;
    
    if (status === 'PREPARING' && !order.extraItems[itemIndex].startedAt) {
      order.extraItems[itemIndex].startedAt = new Date();
    }
    if (status === 'READY') {
      if (!order.extraItems[itemIndex].startedAt) {
        order.extraItems[itemIndex].startedAt = new Date(Date.now() - 60000);
      }
      order.extraItems[itemIndex].readyAt = new Date();
      const seconds = Math.round((order.extraItems[itemIndex].readyAt - order.extraItems[itemIndex].startedAt) / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      order.extraItems[itemIndex].actualPrepTime = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    // Check if all items are SERVED and update order status to READY
    if (status === 'SERVED') {
      const allItemsServed = order.items.every(item => item.status === 'SERVED') &&
                             order.extraItems.every(item => item.status === 'SERVED');
      
      if (allItemsServed && order.status !== 'READY') {
        order.status = 'READY';
      }
    }
    
    order.markModified('extraItems');
    await order.save();

    // Sync with KOT
    try {
      const kot = await KOT.findOne({ orderId });
      if (kot && kot.extraItems && kot.extraItems[itemIndex]) {
        kot.extraItems[itemIndex].status = status;
        if (order.extraItems[itemIndex].startedAt) {
          kot.extraItems[itemIndex].startedAt = order.extraItems[itemIndex].startedAt;
        }
        if (order.extraItems[itemIndex].readyAt) {
          kot.extraItems[itemIndex].readyAt = order.extraItems[itemIndex].readyAt;
          kot.extraItems[itemIndex].actualPrepTime = order.extraItems[itemIndex].actualPrepTime;
        }
        kot.markModified('extraItems');
        await kot.save();
      }
    } catch (kotError) {
      console.error('KOT sync error:', kotError);
    }

    res.json({ message: 'Extra item status updated successfully', order });
  } catch (error) {
    console.error('Update extra item status error:', error);
    res.status(500).json({ error: 'Failed to update extra item status' });
  }
};

// Process payment with enhanced features
exports.processPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { method, amount, transactionId, loyaltyPointsUsed, discountPercentage } = req.body;

    const order = await RestaurantOrder.findById(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Save discount if provided
    if (discountPercentage && discountPercentage > 0) {
      order.discount = {
        percentage: discountPercentage,
        amount: (order.subtotal || order.totalAmount) * discountPercentage / 100
      };
    }

    order.status = 'PAID';
    order.paymentStatus = 'paid';
    order.paymentDetails = {
      method: method || 'CASH',
      amount: amount || order.totalAmount,
      transactionId,
      loyaltyPointsUsed: loyaltyPointsUsed || 0,
      paidAt: new Date()
    };

    await order.save();

    // Update table status
    if (order.tableNumber || order.tableNo) {
      await RestaurantTable.findOneAndUpdate(
        { tableNumber: order.tableNumber || order.tableNo },
        { status: 'available' }
      );
    }

    // Sync KOT status
    try {
      await KOT.updateMany({ orderId: id }, { status: 'PAID' });
    } catch (kotError) {
      console.error('KOT sync error:', kotError);
    }

    res.json({
      message: 'Payment processed successfully',
      order,
      billing: {
        subtotal: order.subtotal,
        discount: order.discount,
        finalAmount: order.totalAmount,
        paidAmount: order.paymentDetails.amount
      }
    });
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
};

// Update restaurant order (legacy support)
exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const originalOrder = await RestaurantOrder.findById(id);
    if (!originalOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = await RestaurantOrder.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );
    
    createAuditLog('UPDATE', 'RESTAURANT_ORDER', order._id, req.user?.id, req.user?.role, originalOrder.toObject(), order.toObject(), req);
    
    // Sync with KOT if items were updated
    if (updateData.items) {
      try {
        const kot = await KOT.findOne({ orderId: id });
        if (kot) {
          const originalKOT = kot.toObject();
          const kotItems = updateData.items.map(item => ({
            menuId: item.menuId || item.itemId,
            name: item.name || item.itemName,
            quantity: item.quantity,
            status: item.status || 'PENDING',
            specialInstructions: item.note || ''
          }));
          const updatedKOT = await KOT.findByIdAndUpdate(kot._id, { items: kotItems }, { new: true });
          
          createAuditLog('UPDATE', 'KOT', kot._id, req.user?.id, req.user?.role, originalKOT, updatedKOT.toObject(), req);
        }
      } catch (kotError) {
        console.error('Error updating KOT:', kotError);
      }
    }
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Link existing restaurant orders to bookings
exports.linkOrdersToBookings = async (req, res) => {
  try {
    const Booking = require('../models/Booking');
    
    const unlinkedOrders = await RestaurantOrder.find({
      $or: [
        { bookingId: { $exists: false } },
        { bookingId: null },
        { grcNo: { $exists: false } },
        { grcNo: null }
      ]
    });
    
    let linkedCount = 0;
    
    for (const order of unlinkedOrders) {
      const tableNum = order.tableNo || order.tableNumber;
      if (tableNum) {
        const booking = await Booking.findOne({
          roomNumber: { $regex: new RegExp(`(^|,)\\s*${tableNum}\\s*(,|$)`) },
          status: { $in: ['Booked', 'Checked In'] },
          isActive: true
        });
        
        if (booking) {
          await RestaurantOrder.findByIdAndUpdate(order._id, {
            bookingId: booking._id,
            grcNo: booking.grcNo,
            roomNumber: booking.roomNumber,
            guestName: booking.name,
            guestPhone: booking.mobileNo
          });
          linkedCount++;
        }
      }
    }
    
    res.json({
      success: true,
      message: `Linked ${linkedCount} restaurant orders to bookings`,
      linkedCount,
      totalUnlinked: unlinkedOrders.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getOrderDetails = async (req, res) => {
  try {
    const order = await RestaurantOrder.findById(req.params.id)
      .populate('items.menuId', 'name price Price')
      .populate('items.nocId', 'name authorityType');
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.transferTable = async (req, res) => {
  try {
    const { newTableNo, oldTableStatus } = req.body;
    const order = await RestaurantOrder.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const oldTableNo = order.tableNo || order.tableNumber;
    
    // Update old table status
    if (oldTableNo) {
      await RestaurantTable.findOneAndUpdate(
        { tableNumber: oldTableNo },
        { status: oldTableStatus || 'available' }
      );
    }
    
    // Update new table to occupied
    await RestaurantTable.findOneAndUpdate(
      { tableNumber: newTableNo },
      { status: 'occupied' }
    );
    
    // Update order with new table
    order.tableNo = newTableNo;
    order.tableNumber = newTableNo;
    await order.save();
    
    // Sync with KOT
    try {
      await KOT.updateMany({ orderId: order._id }, { tableNumber: newTableNo });
    } catch (kotError) {
      console.error('KOT sync error:', kotError);
    }
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.addItems = async (req, res) => {
  try {
    const { items } = req.body;
    const order = await RestaurantOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    const newItems = await Promise.all(
      items.map(async (item) => {
        const menuItem = await MenuItem.findById(item.itemId || item.menuId);
        return {
          menuId: item.itemId || item.menuId,
          name: item.itemName || menuItem.name,
          basePrice: menuItem.Price || menuItem.price || 0,
          quantity: item.quantity,
          itemTotal: (menuItem.Price || menuItem.price || 0) * item.quantity,
          status: 'PENDING',
          isFree: false
        };
      })
    );
    
    order.items.push(...newItems);
    await order.save();
    
    // Sync with KOT
    try {
      const kot = await KOT.findOne({ orderId: order._id });
      if (kot) {
        kot.items.push(...newItems.map(item => ({
          menuId: item.menuId,
          name: item.name,
          quantity: item.quantity,
          status: 'PENDING'
        })));
        await kot.save();
      }
    } catch (kotError) {
      console.error('KOT sync error:', kotError);
    }
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.addTransaction = async (req, res) => {
  try {
    const order = await RestaurantOrder.findByIdAndUpdate(
      req.params.id,
      { paymentStatus: 'paid', status: 'PAID' },
      { new: true }
    );
    
    // Update table status to available when order is paid
    if (order && (order.tableNo || order.tableNumber)) {
      await RestaurantTable.findOneAndUpdate(
        { tableNumber: order.tableNo || order.tableNumber },
        { status: 'available' }
      );
    }
    
    // Sync KOT status
    try {
      await KOT.updateMany({ orderId: order._id }, { status: 'PAID' });
    } catch (kotError) {
      console.error('KOT sync error:', kotError);
    }
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    const order = await RestaurantOrder.findById(req.params.id)
      .populate('items.menuId', 'name price Price');
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

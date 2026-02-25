const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },

    items: [
      {
        menuId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "MenuItem",
          required: true,
        },

        name: {
          type: String,
          required: true,
          trim: true,
        },

        basePrice: {
          type: Number,
          required: true,
          min: 0,
        },

        quantity: {
          type: Number,
          required: true,
          min: 1,
        },

        // VARIATION (Size, Type, etc.)
        variation: {
          variationId: {
            type: String,
          },
          name: {
            type: String,
          },
          price: {
            type: Number,
            min: 0,
          },
        },

        // ADD-ONS (Cheese, Extra Toppings, etc.)
        addons: [
          {
            addonId: {
              type: mongoose.Schema.Types.ObjectId,
            },
            name: {
              type: String,
            },
            price: {
              type: Number,
              min: 0,
            },
          },
        ],

        // FINAL ITEM PRICE
        itemTotal: {
          type: Number,
          required: true,
          min: 0,
        },

        // ITEM STATUS
        status: {
          type: String,
          enum: ["PENDING", "PREPARING", "READY", "SERVED"],
          default: "PENDING",
        },

        // TIME TO PREPARE
        timeToPrepare: {
          type: Number,
          default: 15,
          min: 1
        },

        // ACTUAL PREPARATION TRACKING
        startedAt: Date,
        readyAt: Date,
        actualPrepTime: String,
      },
    ],
    
    extraItems: [
      {
        menuId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "MenuItem",
        },

        name: {
          type: String,
          required: true,
          trim: true,
        },

        basePrice: {
          type: Number,
          min: 0,
        },

        quantity: {
          type: Number,
          required: true,
          min: 1,
        },

        variation: {
          variationId: {
            type: String,
          },
          name: {
            type: String,
          },
          price: {
            type: Number,
            min: 0,
          },
        },

        addons: [
          {
            addonId: {
              type: String,
            },
            name: {
              type: String,
            },
            price: {
              type: Number,
              min: 0,
            },
          },
        ],

        itemTotal: {
          type: Number,
          min: 0,
        },

        status: {
          type: String,
          enum: ["PENDING", "PREPARING", "READY", "SERVED"],
          default: "PENDING",
        },

        timeToPrepare: {
          type: Number,
          default: 15,
          min: 1
        },

        startedAt: Date,
        readyAt: Date,
        actualPrepTime: String,
      },
    ],

    subtotal: {
      type: Number,
      min: 0,
    },

    discount: {
      percentage: {
        type: Number,
        min: 0,
        max: 100,
      },
      amount: {
        type: Number,
        min: 0,
        default: 0,
      },
      reason: {
        type: String,
        trim: true,
        default: "",
      },
      appliedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },

    gst: {
      type: Number,
      default: 0,
      min: 0,
    },

    sgst: {
      type: Number,
      default: 0,
      min: 0,
    },

    cgst: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "ORDER_ACCEPTED",
        "PREPARING",
        "READY",
        "SERVED",
        "COMPLETE",
        "CANCELLED",
        "PAID"
      ],
      default: "PENDING",
    },

    priority: {
      type: String,
      enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
      default: "NORMAL",
    },

    customerName: {
      type: String,
      required: true,
      trim: true,
    },

    customerPhone: {
      type: String,
      trim: true,
    },

    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RestaurantTable",
    },

    tableNumber: {
      type: String,
    },

    guestCount: {
      type: Number,
      min: 1,
    },

    mergedTables: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RestaurantTable",
      },
    ],

    paymentDetails: {
      method: {
        type: String,
        enum: ["CASH", "CARD", "UPI", "ONLINE"],
      },
      amount: {
        type: Number,
        min: 0,
      },
      transactionId: String,
      loyaltyPointsUsed: {
        type: Number,
        default: 0
      },
      paidAt: Date,
    },

    // Legacy fields for backward compatibility
    staffName: {
      type: String,
      required: false,
    },
    phoneNumber: {
      type: String,
      default: ''
    },
    tableNo: {
      type: String,
      required: false
    },
    notes: {
      type: String,
      default: ''
    },
    gstRate: {
      type: Number,
      default: 5,
      min: 0,
      max: 100
    },
    sgstRate: {
      type: Number,
      default: 2.5,
      min: 0,
      max: 50
    },
    cgstRate: {
      type: Number,
      default: 2.5,
      min: 0,
      max: 50
    },
    sgstAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    cgstAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    totalGstAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    amount: {
      type: Number,
      min: 0
    },
    nonChargeable: {
      type: Boolean,
      default: false
    },
    isMembership: {
      type: Boolean,
      default: false
    },
    isLoyalty: {
      type: Boolean,
      default: false
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'partial'],
      default: 'unpaid'
    },
    kotGenerated: {
      type: Boolean,
      default: false
    },
    kotNumber: {
      type: String
    },
    kotGeneratedAt: {
      type: Date
    },
    billGenerated: {
      type: Boolean,
      default: false
    },
    billNumber: {
      type: String
    },
    billGeneratedAt: {
      type: Date
    },
    deliveryTime: {
      type: Date
    }
  },
  { timestamps: true },
);

module.exports = mongoose.model("RestaurantOrder", OrderSchema);

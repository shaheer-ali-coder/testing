require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const paypal = require('paypal-rest-sdk');
const express = require('express');
const axios = require('axios')
const bodyParser = require('body-parser');
const app = express();
const groupId = '-1002279056258'
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
app.use(bodyParser.urlencoded({ extended: true }));
let address_user = []
let users = {};  // Store user data including payment status and last payment dates

const USDT_CONTRACT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT contract address
const REQUIRED_PAYMENT_ETH = 0.01;  // For example, monthly fee in ETH
const REQUIRED_PAYMENT_USDT = 29;   // Monthly fee in USDT

// Function to check ETH balance and verify payment
async function checkETHPayment(address) {
    try {
        const url = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${process.env.ETHERSCAN_API_KEY}`;
        const response = await axios.get(url);
        const transactions = response.data.result;
        
        let totalSent = 0;
        transactions.forEach(tx => {
            // Check if the transaction was sent to our wallet
            if (tx.to.toLowerCase() === '0x2A8bfa96A33Cf69dEBB61d042f9C5Ef323074078'.toLowerCase() && tx.isError === "0") {
                totalSent += parseFloat(tx.value) / (10 ** 18);  // Convert from Wei to ETH
            }
        });

        return totalSent >= REQUIRED_PAYMENT_ETH;
    } catch (error) {
        console.error("Error checking ETH payment:", error);
        return false;
    }
}

// Function to check USDT balance and verify payment
async function checkUSDTTransaction(address) {
    try {
        const url = `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${USDT_CONTRACT_ADDRESS}&address=${address}&page=1&offset=100&startblock=0&endblock=99999999&sort=asc&apikey=${process.env.ETHERSCAN_API_KEY}`;
        const response = await axios.get(url);
        const transactions = response.data.result;

        let totalUSDT = 0;
        transactions.forEach(tx => {
            // Check if the transaction was sent to our wallet
            if (tx.to.toLowerCase() === '0x2A8bfa96A33Cf69dEBB61d042f9C5Ef323074078'.toLowerCase() && tx.tokenSymbol === 'USDT') {
                totalUSDT += parseFloat(tx.value) / (10 ** 6);  // USDT has 6 decimal places
            }
        });

        return totalUSDT >= REQUIRED_PAYMENT_USDT;
    } catch (error) {
        console.error("Error checking USDT transaction:", error);
        return false;
    }
}

// Configure PayPal
paypal.configure({
    'mode': 'live', // Use 'live' for production
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

// Crypto payment addresses
const paymentOptions = `
**Crypto Payments:**
- USDT (ETH Network): \`0x2A8bfa96A33Cf69dEBB61d042f9C5Ef323074078\` (tap to copy)
- ETH: \`0x2A8bfa96A33Cf69dEBB61d042f9C5Ef323074078\` (tap to copy)

**PayPal Subscriptions:**
- Monthly: $29
- Yearly: $150
- Lifetime: $299
`;

// Handle '/start' command to show subscription options
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId, `Welcome! Choose your payment method:\n\n${paymentOptions}\n\nTo pay:\n- /pay monthly\n- /pay yearly\n- /pay lifetime\n- /pay crypto`, { 
        parse_mode: 'Markdown' 
    });

    // Initialize user payment data
    users[chatId] = { paymentStatus: false, paymentMethod: null, lastPaymentDate: null };
});

// Handle payment selection
bot.onText(/\/pay/, (msg) => {
    const chatId = msg.chat.id;
    const paymentType = msg.text.split(' ')[1];  // User will type '/pay monthly' or '/pay crypto'

    if (paymentType === 'crypto') {
        // Inform user to send crypto to wallet address
        bot.sendMessage(chatId, `Send the required amount to the USDT or ETH wallet and reply with /confirm {your_wallet_address} when done.`);
        users[chatId].paymentMethod = 'crypto';
    } else if (paymentType === 'monthly' || paymentType === 'yearly' || paymentType === 'lifetime') {
        // Start PayPal payment for subscription
        const plan = {
            monthly: { price: 29, duration: 'Monthly' },
            yearly: { price: 150, duration: 'Yearly' },
            lifetime: { price: 299, duration: 'Lifetime' }
        };

        createPaypalPayment(plan[paymentType], chatId);
        users[chatId].paymentMethod = 'paypal';
        users[chatId].paymentPlan = plan[paymentType]
    } else {
        bot.sendMessage(chatId, "Please choose a valid payment method: /pay [crypto|monthly|yearly|lifetime]");
    }
});

// Confirm payment manually for crypto
bot.onText(/\/confirm/, async(msg) => {
    const chatId = msg.chat.id;
    if(users[chatId]){
    if (users[chatId].paymentMethod === 'crypto') {
      // Check if the payment is made via ETH or USDT
      const address = msg.text.split(' ')[1];
      if(address_user.includes(address)){
        bot.sendMessage(chatId , 'This contract Address has already been used!')
      }else{
      const isETHPaid = await checkETHPayment(address);
      const isUSDTPaid = await checkUSDTTransaction(address);

      if (isETHPaid || isUSDTPaid) {
          users[chatId].paymentStatus = true;
          users[chatId].lastPaymentDate = new Date();
        //   bot.sendMessage(chatId, "Payment confirmed! You've been added to the group.");
        bot.createChatInviteLink(groupId).then((inviteLink) => {
            // Send the invite link to the user
            bot.sendMessage(chatId, `Payment Confirmed! Please join the group using this invite link: ${inviteLink.invite_link}`);
            address_user.push(address)
        }).catch(error => {
            console.error("Error creating invite link:", error);
        });
      } else {
          bot.sendMessage(chatId, "No valid payment found. Please make sure you sent the correct amount.");
      }}
  } else {
      bot.sendMessage(chatId, "You need to select a crypto payment method first.");
  } }
});
// Create PayPal Payment
function createPaypalPayment(plan, chatId) {
    const create_payment_json = {
        "intent": "sale",
        "payer": { 
            "payment_method": "paypal" 
        },
        "redirect_urls": {
            "return_url": "https://specialtradesignalbot.io/confirmation",
            "cancel_url": "https://specialtradesignalbot.io/cancel"
        },
        "transactions": [{
            "item_list": { 
                "items": [{ 
                    "name": plan.duration, 
                    "price": plan.price, 
                    "currency": "USD", 
                    "quantity": 1 
                }] 
            },
            "amount": { 
                "currency": "USD", 
                "total": plan.price 
            },
            "description": `${plan.duration} subscription for Telegram bot`,
            // Adding custom field to pass chatId
            "custom": chatId  // This is where you pass the chatId to PayPal
        }]
    };

    paypal.payment.create(create_payment_json, (error, payment) => {
        if (error) {
            console.error(error);
        } else {
            payment.links.forEach((link) => {
                if (link.rel === 'approval_url') {
                    bot.sendMessage(chatId, `Please complete your payment: ${link.href}`);
                }
            });
        }
    });
}

cron.schedule('0 0 1 * *', () => {
  const now = new Date();
  
  Object.keys(users).forEach(chatId => {
      const user = users[chatId];

      // Check for users with a PayPal payment method
      if (user.paymentMethod === 'paypal' && !user.paymentStatus) {
          bot.kickChatMember(chatId);
          bot.sendMessage(chatId, "You've been removed due to non-payment.");
      }
      
      // Check for users with a crypto payment method
      else if (user.paymentMethod === 'crypto' && user.lastPaymentDate) {
          
          // Handle monthly payment plan
          if (user.paymentPlan === 'monthly') {
              const oneMonthAgo = new Date();
              oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
              if (user.lastPaymentDate < oneMonthAgo) {
                  bot.kickChatMember(chatId);
                  bot.sendMessage(chatId, "You've been removed for non-renewal of your monthly crypto payment.");
              }
          }
          
          // Handle yearly payment plan
          else if (user.paymentPlan === 'yearly') {
              const oneYearAgo = new Date();
              oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
              if (user.lastPaymentDate < oneYearAgo) {
                  bot.kickChatMember(chatId);
                  bot.sendMessage(chatId, "You've been removed for non-renewal of your yearly crypto payment.");
              }
          }

          // Handle lifetime payment plan (no action needed)
          else if (user.paymentPlan === 'lifetime') {
              // No need to check anything, as lifetime users should never be removed.
              // bot.sendMessage(chatId, "You're on a lifetime plan. No renewal needed.");
          }
      }
  });
})
app.post('/confirmation', (req, res) => {

            const event = req.body
      // If PayPal verifies the IPN message as valid
      
          // Check payment status and other transaction details
          if (event.event_type === 'PAYMENT.SALE.COMPLETED') {

            const sale = event.resource;  // The sale object contains payment details
            const customField = sale.custom;  // Custom field contains the chatId if passed
            const chatId = customField;  // Assuming custom contains the chat ID
     // Assuming chatId is passed in the PayPal custom field
              users[chatId].paymentStatus = true;
              users[chatId].lastPaymentDate = new Date();

            //   bot.sendMessage(chatId, "Your PayPal payment has been confirmed, and you've been added to the group.");
            bot.createChatInviteLink(groupId).then((inviteLink) => {
                // Send the invite link to the user
                bot.sendMessage(chatId, `Payment Confirmed ! Please join the group using this invite link: ${inviteLink.invite_link}`);
            }).catch(error => {
                console.error("Error creating invite link:", error);
            });
              // Add user to the group
            //   bot.unbanChatMember(chatId);  // This assumes the user was banned or kicked before
          }
      

  res.status(200).send('OK');
});
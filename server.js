const express = require('express');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Конфигурация Kassa.ai
const KASSA_CONFIG = {
    merchantId: process.env.KASSA_MERCHANT_ID,
    secretKey: process.env.KASSA_SECRET_KEY,
    baseUrl: process.env.KASSA_BASE_URL || 'https://payment.kassa.ai'
};

console.log('🚀 Сервер запускается...');

// Статические файлы из корня
app.use(express.static(__dirname));

// Явные роуты для всех страниц
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'success.html'));
});

app.get('/fail', (req, res) => {
    res.sendFile(path.join(__dirname, 'fail.html'));
});

// API роуты
app.post('/api/create-payment', async (req, res) => {
    try {
        const { amount, orderId, email, phone, description, paymentMethod } = req.body;

        if (!amount || !orderId || !email) {
            return res.status(400).json({
                success: false,
                error: 'Необходимые поля: amount, orderId, email'
            });
        }

        // Реальный режим - работа с Kassa.ai
        const paymentData = {
            merchant_id: KASSA_CONFIG.merchantId,
            amount: Math.round(amount * 100),
            currency: 'RUB',
            order_id: orderId,
            description: description || `Оплата заказа ${orderId}`,
            customer_email: email,
            customer_phone: phone || '',
            success_url: `${getBaseUrl(req)}/success?order_id=${orderId}`,
            fail_url: `${getBaseUrl(req)}/fail?order_id=${orderId}`,
            callback_url: `${getBaseUrl(req)}/api/payment-callback`,
            payment_method: paymentMethod || 'card'
        };

        // Удаляем пустые поля
        Object.keys(paymentData).forEach(key => {
            if (paymentData[key] === '' || paymentData[key] == null) {
                delete paymentData[key];
            }
        });

        // Создание подписи
        const signString = Object.keys(paymentData)
            .sort()
            .map(key => `${key}=${paymentData[key]}`)
            .join('&');
        
        const signature = crypto
            .createHmac('sha256', KASSA_CONFIG.secretKey)
            .update(signString)
            .digest('hex');
        
        paymentData.sign = signature;

        console.log('📦 Создание платежа:', { orderId, amount });

        const response = await fetch(`${KASSA_CONFIG.baseUrl}/api/v1/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(paymentData)
        });

        const result = await response.json();

        if (result.success && result.payment_url) {
            res.json({
                success: true,
                paymentUrl: result.payment_url,
                paymentId: result.payment_id
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error || 'Ошибка платежной системы'
            });
        }
        
    } catch (error) {
        console.error('🔥 Ошибка:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Callback от Kassa.ai
app.post('/api/payment-callback', (req, res) => {
    try {
        const callbackData = req.body;
        
        console.log('📢 Callback от Kassa.ai:', {
            orderId: callbackData.order_id,
            status: callbackData.status,
            paymentId: callbackData.payment_id
        });

        // Верификация подписи
        const sign = callbackData.sign;
        delete callbackData.sign;

        const signString = Object.keys(callbackData)
            .sort()
            .map(key => `${key}=${callbackData[key]}`)
            .join('&');

        const expectedSign = crypto
            .createHmac('sha256', KASSA_CONFIG.secretKey)
            .update(signString)
            .digest('hex');

        if (sign !== expectedSign) {
            console.error('❌ Неверная подпись в callback');
            return res.status(400).send('Invalid signature');
        }

        // Обработка статуса платежа
        switch (callbackData.status) {
            case 'succeeded':
                console.log(`✅ Платеж успешен для заказа ${callbackData.order_id}`);
                break;
            case 'failed':
                console.log(`❌ Платеж failed для заказа ${callbackData.order_id}`);
                break;
            case 'canceled':
                console.log(`⚠️ Платеж отменен для заказа ${callbackData.order_id}`);
                break;
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Ошибка обработки callback:', error);
        res.status(500).send('Error');
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString()
    });
});

// Fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function getBaseUrl(req) {
    return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 URL: ${getBaseUrl({ protocol: 'https', get: () => 'your-app.onrender.com' })}`);
});

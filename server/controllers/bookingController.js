const Booking = require('../models/Booking');
const Event = require('../models/Event');
const OTP = require('../models/OTP');
const { sendBookingEmail, sendOTPEmail } = require('../utils/email');

// OTP generator
const generateOTP = () =>
    Math.floor(100000 + Math.random() * 900000).toString();


// =======================
// SEND BOOKING OTP
// =======================
exports.sendBookingOTP = async (req, res) => {
    try {
        const email = req.user.email;

        const otp = generateOTP();

        // delete old OTPs
        await OTP.deleteMany({
            email,
            action: 'event_booking'
        });

        await OTP.create({
            email,
            otp,
            action: 'event_booking'
        });

        // 🚀 NON-BLOCKING (fast response)
        sendOTPEmail(email, otp, 'event_booking');

        return res.json({
            message: 'OTP sent successfully'
        });

    } catch (error) {
        return res.status(500).json({
            message: 'Error sending OTP',
            error: error.message
        });
    }
};


// =======================
// BOOK EVENT
// =======================
exports.bookEvent = async (req, res) => {
    try {
        const { eventId, otp } = req.body;
        const email = req.user.email;

        if (!eventId || !otp) {
            return res.status(400).json({
                message: 'Event ID and OTP required'
            });
        }

        // verify OTP
        const validOTP = await OTP.findOne({
            email,
            otp,
            action: 'event_booking'
        });

        if (!validOTP) {
            return res.status(400).json({
                message: 'Invalid or expired OTP'
            });
        }

        const event = await Event.findById(eventId);

        if (!event) {
            return res.status(404).json({
                message: 'Event not found'
            });
        }

        if (event.availableSeats <= 0) {
            return res.status(400).json({
                message: 'No seats available'
            });
        }

        // prevent duplicate booking
        const existingBooking = await Booking.findOne({
            userId: req.user.id,
            eventId,
            status: { $ne: 'cancelled' }
        });

        if (existingBooking) {
            return res.status(400).json({
                message: 'Already booked or pending'
            });
        }

        const booking = await Booking.create({
            userId: req.user.id,
            eventId,
            status: 'pending',
            paymentStatus: 'not_paid',
            amount: event.ticketPrice
        });

        // remove OTP after success
        await OTP.deleteOne({ _id: validOTP._id });

        return res.status(201).json({
            message: 'Booking request submitted',
            booking
        });

    } catch (error) {
        return res.status(500).json({
            message: 'Server Error',
            error: error.message
        });
    }
};


// =======================
// CONFIRM BOOKING
// =======================
exports.confirmBooking = async (req, res) => {
    try {
        const { paymentStatus } = req.body;

        const booking = await Booking.findById(req.params.id)
            .populate('userId')
            .populate('eventId');

        if (!booking) {
            return res.status(404).json({
                message: 'Booking not found'
            });
        }

        if (booking.status === 'confirmed') {
            return res.status(400).json({
                message: 'Already confirmed'
            });
        }

        const event = await Event.findById(booking.eventId._id);

        if (!event || event.availableSeats <= 0) {
            return res.status(400).json({
                message: 'No seats available'
            });
        }

        booking.status = 'confirmed';
        if (paymentStatus) {
            booking.paymentStatus = paymentStatus;
        }

        await booking.save();

        event.availableSeats -= 1;
        await event.save();

        // 🚀 non-blocking email
        sendBookingEmail(
            booking.userId.email,
            booking.userId.name,
            booking.eventId.title
        );

        return res.json({
            message: 'Booking confirmed successfully',
            booking
        });

    } catch (error) {
        return res.status(500).json({
            message: 'Server Error',
            error: error.message
        });
    }
};


// =======================
// GET BOOKINGS
// =======================
exports.getMyBookings = async (req, res) => {
    try {
        const bookings =
            req.user.role === 'admin'
                ? await Booking.find()
                    .populate('eventId')
                    .populate('userId', 'name email')
                    .sort({ createdAt: -1 })
                : await Booking.find({ userId: req.user.id })
                    .populate('eventId')
                    .sort({ createdAt: -1 });

        return res.json(bookings);

    } catch (error) {
        return res.status(500).json({
            message: 'Server Error',
            error: error.message
        });
    }
};


// =======================
// CANCEL BOOKING
// =======================
exports.cancelBooking = async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);

        if (!booking) {
            return res.status(404).json({
                message: 'Booking not found'
            });
        }

        if (
            booking.userId.toString() !== req.user.id &&
            req.user.role !== 'admin'
        ) {
            return res.status(403).json({
                message: 'Not authorized'
            });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({
                message: 'Already cancelled'
            });
        }

        const wasConfirmed = booking.status === 'confirmed';

        booking.status = 'cancelled';
        await booking.save();

        if (wasConfirmed) {
            const event = await Event.findById(booking.eventId);

            if (event) {
                event.availableSeats += 1;
                await event.save();
            }
        }

        return res.json({
            message: 'Booking cancelled successfully'
        });

    } catch (error) {
        return res.status(500).json({
            message: 'Server Error',
            error: error.message
        });
    }
};
const http = require('http');
const dgram = require('dgram');
const udp = dgram.createSocket('udp4');

/* some user-defined variables */
const piholeAPI = '192.168.1.28';

const address = '192.168.1.128';
const port = 8125;
const prefix = '_t_';
const interval = 1000; //update every 10s

const debug = false;

/**
 * Creates a tag object
 * @param {string} tag - tag name
 * @param {string|number} value - tag value
 * @return tag object
 */
const tag = (tag, value) => {
    const format = (input) => {
        if (typeof input === 'string') {
            return input.replace(/\./g, '-').replace(/ /g, '-');
        }
        return input;
    };

    return {
        tag: format(tag),
        value: format(value)
    };
};

/**
 * send a UDP packet to the address:port
 * @param {string|string[]} message - the message(s) to send
 */
const send = (message) => {
    if (Array.isArray(message)) {
        message = message.join('\n');
    }

    if (!debug) {
        udp.send(message, port, address, (err) => {
            if (err) {
                console.log(err);
            }
        });
    } else {
        console.log(message);
    }
};

/**
 * format some input for statsd
 * @param {string} metric - metric name
 * @param {number} value - metric value
 * @param {string} type - metric type, one of 'c', 's', 'ms', or 'g'
 * @param {Tag[]} moreTags - any additional tag objects to send; default adds hostname
 * @return {string} statsd-ready string
 */
const statsdFormat = (metric, value, type, moreTags) => {
    const allowedMetrics = ['c', 's', 'g', 'ms'];
    let tags;

    /**
     * perform type check
     */
    if (!allowedMetrics.includes(type)) {
        throw new Error(`${JSON.stringify(type)} is not a statsd metric type (one of 'c', 's', 'ms', or 'g')`);
    }

    /**
     * parse through all the tags, adding the prefix and formatting tags for sending
     * add the default location:pihole tag
     */
    moreTags = moreTags || [];
    moreTags.push(tag('location', 'pihole'));
    tags = moreTags.map(elem => {
        return `${prefix}${elem.tag}.${elem.value}`;
    }).join('.');

    return `${metric}${tags === '' ? '' : `.${tags}`}:${value}|${type}`;
};

/**
 * does the brunt of the work: requests information, then sends it off
 */
const main = () => {
    http.get(`http://${piholeAPI}/admin/api.php`, (res) => {
        res.setEncoding('utf8');
        let rawData = '';

        res.on('data', chunk => {
            rawData += chunk;
        });


        res.on('end', () => {
            const data = JSON.parse(rawData);

            ['status', 'clients_ever_seen', 'unique_clients', 'unique_domains', 'FTLnotrunning'].forEach(elem => {
                delete data[elem];
            });

            for (let stat in data) {
                if (stat === 'gravity_last_updated') {
                    for (let gravStat in data[stat]) {
                        if (!(['relative', 'file_exists', 'absolute'].includes(gravStat))) {
                            send(statsdFormat(gravStat, data[stat][gravStat], 'c', [tag('pihole', 'grav')]));
                        } else if (gravStat === 'relative') {
                            let days = data[stat][gravStat]['days'];
                            let hours = data[stat][gravStat]['hours'];
                            let minutes = data[stat][gravStat]['minutes'];
                            let total = (days * 24 * 60) + (hours * 60) + (minutes * 1);
                            send(statsdFormat('last_updated', total, 'c', [tag('pihole', 'grav')]));
                        }
                    }
                } else {
                    send(statsdFormat(stat, data[stat], 'c', [tag('pihole', 'top')]));
                }
            }
        });
    });
};

setInterval(main, interval);

main();

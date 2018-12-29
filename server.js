'use strict';

//Application Dependencies
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

//Load env vars;
require('dotenv').config();
const PORT = process.env.PORT || 3000;

//postgres
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.error(err));

//app
const app = express();
app.use(cors());

//routes
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/yelp', getYelp);
app.get('/movies', getMov);

//========================LOOK FOR RESULTS IN DATABASE==============================================//

//Handlers
function getLocation(request, response) {
  Location.lookupLocation({
    tableName: Location.tableName,
    query: request.query.data,

    cacheHit: function(result) {
      console.log('Location retreived from Database');
      response.send(result.rows[0]);
    },

    cacheMiss: function() {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${this.query}&key=${process.env.GEOCODE_API_KEY}`;
      return superagent.get(url)
        .then(result => {
          const location = new Location(this.query, result);
          location.save()
            .then(location => response.send(location));
        })
        .catch(error => handleError(error));
    }
  });
}

function getWeather(request, response) {
  const weatherHandler = {
    tableName: Weather.tableName,
    location: request.query.data.id,

    cacheHit: function (result) {
      console.log('Weather retreived from Database');
        response.send(result.rows);
    },
    cacheMiss: function () {
      const url = `https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;
      superagent.get(url)
        .then(result => {
          const weatherSummaries = result.body.daily.data.map(day => {
            const summary = new Weather(day);
            summary.save(request.query.data.id);
            return summary;
          });
          response.send(weatherSummaries);
        })
        .catch(error => handleError(error, response));
    }
  };
  Weather.lookup(weatherHandler);
}

function getMov(request, response) {
  const movieHandler = {
    tableName: Movie.tableName,
    location: request.query.data.id,

    cacheHit: function (result) {
      console.log('Movie retreived from Database');
      response.send(result.rows);
    },
    cacheMiss: function () {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIE_API_KEY}&query=${request.query}`;
      return superagent.get(url)
        .then(results => {
          console.log('inside cache miss');
          const movieSummaries = results.body.results.map(movie => {
            const summary = new Movie(movie);
            summary.save(request.query.data.id);
            return summary;
          });
          console.log(movieSummaries, 'MOOOOVIES');
          response.send(movieSummaries);
        })
        .catch(error => handleError(error, response));
    }
  };
  Movie.lookup(movieHandler);
}

function getYelp(request, response) {
  const yelpHandler = {
    tableName: Bsns.tableName,
    location: request.query.data.id,

    cacheHit: function (result) {
      console.log('Yelp retreived from Database');
      response.send(result.rows);
    },
    cacheMiss: function () {
      const url = `https://api.yelp.com/v3/businesses/search?term=delis&latitude=${request.query.data.latitude}&longitude=${request.query.data.longitude}`;
      return superagent.get(url)
        .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
        .then(results => {
          const yelpSummaries = results.body.businesses.map(bsns => {
            const summary =  new Bsns(bsns);
            summary.save(request.query.data.id);
            return summary;
          });
          response.send(yelpSummaries);
        })
        .catch(error => handleError(error, response));
    }
  };
  Bsns.lookup(yelpHandler);
}

//Constructor Function
function Location(query, res){
  this.tableName = 'locations';
  this.search_query = query;
  this.formatted_query = res.body.results[0].formatted_address;
  this.latitude = res.body.results[0].geometry.location.lat;
  this.longitude = res.body.results[0].geometry.location.lng;
}

function Weather(forecast) {
  this.tableName = 'weathers';
  this.forecast = forecast.summary;
  this.time = new Date(forecast.time * 1000).toString().slice(0, 15);
}

Weather.tableName = 'weathers';
Weather.lookup = lookup;

function Movie(movie) {
  this.tableName = 'movies';
  this.title = movie.title;
  this.overview = movie.overview;
  this.average_votes = movie.vote_average;
  this.total_votes = movie.vote_count;
  this.image_url = `http://image.tmdb.org/t/p/w200_and_h300_bestv2${movie.poster_path}`;
  this.popularity = movie.popularity;
  this.released_on = movie.release_date;
}

Movie.tableName = 'movies';
Movie.lookup = lookup;

function Bsns (bsns) {
  this.tableName = 'businesses';
  this.name = bsns.name;
  this.image_url = bsns.image_url;
  this.price = bsns.price;
  this.rating = bsns.rating;
  this.url = bsns.url;
}

Bsns.tableName = 'businesses';
Bsns.lookup = lookup;

//SQL
Location.lookupLocation = (location) => {
  const SQL = 'SELECT * FROM locations WHERE search_query=$1;';
  const values = [location.query];

  return client.query(SQL, values)
    .then(result => {
      if(result.rowCount > 0) {
        location.cacheHit(result);
      } else {
        location.cacheMiss();
      }
    })
    .catch(console.error);
};

function lookup(options) {
  const SQL = `SELECT * FROM ${options.tableName} WHERE location_id=$1;`;
  const values = [options.location];

  client.query(SQL, values)
    .then(result => {
      if (result.rowCount > 0) {
        options.cacheHit(result);
      } else{
        options.cacheMiss();
      }
    })
    .catch(error => handleError(error));
}


//Search Functions
Location.prototype = {
  save: function() {
    const SQL = 'INSERT INTO locations (search_query, formatted_query, latitude, longitude, create_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id;';
    const values = [this.search_query, this.formatted_query, this.latitude, this.longitude, Date.now()];

    return client.query(SQL, values)
      .then(result => {
        this.id = result.rows[0].id;
        return this;
      });
  }
};

Weather.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (forecast, time, create_at, location_id) VALUES ($1, $2, $3, $4);`;
    const values = [this.forecast, this.time, Date.now(), location_id];

    client.query(SQL, values);
  }
};

Movie.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (title, overview, average_votes, total_votes, image_url, popularity, released_on, create_at, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
    const values = [this.title, this.overview, this.average_votes, this.total_votes, this.image_url, this.popularity, this.released_on, Date.now(), location_id];

    client.query(SQL, values);
  }
};

Bsns.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (name, image_url, price, rating, url, create_at,location_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    const values = [this.name, this.image_url, this.price, this.rating, this.url, Date.now(),location_id];

    client.query(SQL, values);
  }
};

// Error messages
app.get('/*', function(request, response) {
  response.status(404).send('halp, you are in the wrong place');
});

// Error handler
function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry, something went wrong');
}

app.listen(PORT, () => {
  console.log(`app is up on port : ${PORT}`);
});
